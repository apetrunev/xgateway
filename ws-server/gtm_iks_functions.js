var crypto = require('crypto');
var log4js = require('log4js');
var nodem = require('nodem');
var nconf = require('nconf');
var globals = require('globalsjs');

var gtm = new nodem.Gtm();

var workerLog;  
var logfileSize; 
var logger;

var defaultWorkerLog = "./server-iks-db-worker.log";
var defaultLogfileSize = "400000";

function init() {
	var ret = gtm.open();
	if (ret && ret.ok !== 1) {
		return ret;
        }
	/* initialize globals module */
	globals.init(gtm);
	/* get settings from config */
	nconf.file({ "file" : "config.json" });
	workerLog = nconf.get("logger:workerLogfilePath") || defaultWorkerLog;
	logfileSize = nconf.get("logger:logfileSize") || defaultLogfileSize;
	/* logger initialization */
	log4js.configure({
		"appenders": [
				{
				 "type" : 'file',
				 "filename" : workerLog,
				 "category" : 'gtm_iks_functions.js',
				 "maxLogSize" : logfileSize,
				 "backups": 3 
				}
			     ]
	});
	logger = log4js.getLogger('gtm_iks_functions.js');
	return ret;
}

function terminate() {
	gtm.close();
}

/*
 * IKS FUNCTIONS
 *
 */

function login(data) {
	var res = {};
        var sessionId = crypto.randomBytes(20).toString('hex');
	/* after success login we get uniq key */
	try {
		err = JSON.parse(globals.function("wLogin^wrappers", sessionId, data.id, data.password, data.private_pass));
	} catch (e) {
		logger.error("login: JSON:parse " + e.toString());
		res.method = "login";
		res.err = e.toString();
		return res;
	}
        /* if error occured send error message to client */
        if (err.errmsg != '') {
		/* log error */
                logger.error("login: db.login " + err.errmsg);
		res.method = "login";
		res.err = err.errmsg;
		return res;
        }  
	/* success */
	res.method = "login";
	res.key = sessionId;
	res.err = null;
	return res;
}

function get_globname(glvn) {
	return glvn.match(/^[^]([a-zA-Z0-9]+)[(]/)[1];
}

function get_globsubs(glvn) {
	var glbsubs;

	glbsubs = glvn.match(/[(](.+)[)]/)[1];
	/* replace quoutes everywhere */
	glbsubs = glbsubs.replace(/"/g, '');
	/* convert it to an array */
	glbsubs = glbsubs.split(","); 

	return glbsubs;
}

function get_availdoc(data) {
        var obj, res = {};
	var result, glbname, glbsubs, err;
	/* get temporary global (per session node where functions put its results) */
	try {
		result = JSON.parse(globals.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("get_availdoc: JSON.parse() " + e.toString());
		res.method = "get_availdoc";
		res.err = e.toString();
		return res;
	}
	/* check for errors */
	if (result.errmsg && result.errmsg != "") {
		logger.error("get_availdoc: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "get_availdoc";
		res.err = result.errmsg;
		return res;
	}
	/* extract global name and its subs */
	glbname = get_globname(result.glvn);
        glbsubs = get_globsubs(result.glvn);
	/* push empty node for global's traversing */
	glbsubs.push('');
        /* get_availdoc stores list of available docs to uniq global */    
	try {
		err = JSON.parse(globals.function("wGetAvailDoc^wrappers", data.key));	
	} catch (e) {
		logger.error("get_availdoc: JSON.parse() " + e.toString());
		res.method = "get_availdoc";
		res.err = e.toString();
		return res;
	}
	if (err.errmsg !== '') {
		logger.error("get_availdoc: wGetAvailDoc^wrappers() " + err.errmsg);
		res.method = "get_availdoc";
		res.err = err.errmsg;
		return res; 		
	}
        var node = { "global" : glbname, "subscripts" : glbsubs };                          
	var docs = {}, data, arr;       
	/* get list of docs from the global */  
	while ((node = gtm.order(node)).result) { 
		var sub = node.result;
		data = gtm.get(node).data;
        	/* parsing docs string */
		arr = data.split('#');
        	docs[arr[1]] = arr[0];

		node.subscripts.pop();
		node.subscripts.push(sub);         
	}                        
	/* success */
	res.method = "get_availdoc";
	res.err = null;
	res.data = docs;
	return res;
}

function get_infodoc(data) {
	var obj, result, res = {};
	var glbname, glbsubs, node, err;
	/* get_doc returns data to uniq per-session global */
	try {
		err = JSON.parse(globals.function("wGetDoc^wrappers", data.key, data.type, data.num));
	} catch (e) {
		logger.error("get_infodoc: JSON.parse() " + e.toString());
		res.method = "get_infodoc";
		res.err = e.toString();
		return res;
	}
	if (err.errmsg != "") {
		logger.error("get_infodoc: wGetDoc^wrappers() " + err.errmsg);
		res.method = "get_infodoc";
		res.err = err.errmsg;
		return res;
	}
	/* get the global */
	try {
		result = JSON.parse(globals.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("get_infodoc: JSON.parse() " + e.toString());
                res.method = "get_infodoc";
                res.err = e.toString();
                return res;
	}
	if (result.errmsg != "") {
		logger.error("get_infodoc: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "get_infodoc";
		res.err = result.errmsg;
		return res;
	}	
	glbname = get_globname(result.glvn);
	glbsubs = get_globsubs(result.glvn);
	/* number of packages in the document */
	var node = { "global" : glbname, "subscripts" : glbsubs };
	var count_upac_fact = gtm.get(node).data.toString();
	/* we have three nodes : 1, 2, 3
	 * traverse these in order
	 */
	glbsubs.push('1');
	/* remember the node index */
	var idx = glbsubs.length - 1;
	/* push empty node for traversal*/
	glbsubs.push('');
	/* get details about materials */
	var node = { "global" : glbname, "subscripts" : glbsubs };
	var material = [];
	while ((node = gtm.order(node)).result) {
		/* sub contain information in the form of id_material#id_owner#operation */
		var sub = node.result;
		var arr = sub.split('#');
		var id_material = arr[0],
		    id_owner = arr[1],
		    operation = arr[2] == "" ? "" : "+";

		var data = gtm.get(node).data;
		var values = data.split('#');
			
		values.push(id_material);
		values.push(id_owner);
		values.push(operation);
		
		var keys = [ "kod",
			     "ostatok_plan",
			     "fact",
			     "name",
			     "id",
			     "id_owner",
			     "operation" ];
		/* save items to object */
		var item = {};

		for (var i = 0; i < values.length; i++) 
			item[keys[i]] = values[i];

		material.push(item);

		node.subscripts.pop();
		node.subscripts.push(sub);
	}
	/* change node index */
	glbsubs[idx] = '2';
	/* get document full info */
	node = { "global" : glbname, "subscripts" : glbsubs };
	var full_info = {};
	while ((node = gtm.order(node)).result) {
		var sub = node.result;
		var data = gtm.get(node).data;
		/* key#value pairs */
		var arr = data.split('#');
		var key = arr[0], value = arr[1];
		full_info[key] = value;

		node.subscripts.pop();
		node.subscripts.push(sub);
	}
	glbsubs[idx] = '3';
	/* get short info */
	node = { "global" : glbname, "subscripts" : glbsubs };
	var short_info = {};
	while ((node = gtm.order(node)).result) {	
		var sub = node.result;
		var data = gtm.get(node).data;
		var arr = data.split('#');
		var key = arr[0], value = arr[1];
		short_info[key] = value;
	
		node.subscripts.pop();
		node.subscripts.push(sub);
	}
	/* construct object to return */
	var data = {};
	data.package_content = material;
	data.short_info = short_info;
	data.full_info = full_info;
	data.total_packages = count_upac_fact;

	res.method = "get_infodoc";
	res.err = null;
	res.data = data;
	return res;		
}

function get_package_content(data) {
	var result, err, res = {};

	try {
		err = JSON.parse(globals.function("wSpecVd^wrappers", data.key, data.barcode));
	} catch (e) {
		logger.error("get_package_content: JSON.parse() " + e.toString());
		res.method = "get_package_content";
		res.err = e.toString();
		return res;
	}
	if (err.errmsg !== '') {
		logger.error("get_package_content: wSpecVd^wrappers() " + err.errmsg);
		res.method = "get_package_content";
		res.err = err.errmsg;
		return res;		
	}		
	/* get the global */
	try {
		result = JSON.parse(globals.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("get_package_content: JSON.parse() " + e.toString());
		res.method = "get_package_content";
		res.err = e.toString();
		return res;
	}

	if (result.errmsg != '') {
		logger.error("get_package_content: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "get_package_content";
		res.err = result.errmsg;
		return res;
	}
	
	var glbname = get_globname(result.glvn);
	var glbsubs = get_globsubs(result.glvn);

	var node = { "global" : glbname, "subscripts" : glbsubs };
	var pkg_name = gtm.get(node).data;
	
	/* here we have two nodes 
	 * 1 - primary material branch
	 * 2 - secondary material branch 
	 */
	
	/* traverse primary material first */
	glbsubs.push('1');
	/* index of material node */
	var idx = glbsubs.length - 1;
	glbsubs.push('');
	
	node = { "global" : glbname, "subscripts" : glbsubs };
	var primary = [];
	while ((node = gtm.order(node)).result) {	
		var sub = node.result;
		var obj = {};

		/* sub contains information in the form: id_material#id_portion */
		var arr = sub.split('#');
		obj["id_material"] = arr[0];
		obj["id_portion"] = arr[1];
			
		var pkg_content = gtm.get(node).data;
		
		arr = pkg_content.split('#');
		obj["count"] = arr[0];
		obj["count_storage_unit"] = arr[1];
		
		primary.push(obj);

		node.subscripts.pop();
		node.subscripts.push(sub);
	}
	/* traverse secondary material */	
	glbsubs[idx] = '2';
	node = { "global" : glbname, "subscripts" : glbsubs };
	var secondary = [];
	while ((node = gtm.order(node)).result) {
		var sub = node.result;
		var arr = sub.split('#');
		var obj = {};

		obj["id_material"] = arr[0];
		obj["id_portion"] = arr[1];

		var pkg_content = gtm.get(node).data;
		
		arr = pkg_content.split('#');
		obj["count"] = arr[0];
		obj["count_storage_unit"] = arr[1];

		secondary.push(obj);
		
		node.subscripts.pop();
		node.subscripts.push(sub);	
	} 
	var data = {};
	data.name = pkg_name;
	data.primary = primary;
	data.auxiliary = secondary;

	res.method = "get_package_content"
	res.err = null;
	res.data = data;
	return res; 
}

/* get barcode details */
function decode_barcode(data) {
	var err, result, res = {};
	
	try {
		err = JSON.parse(globals.function("wDecodeShk^wrappers", data.key, data.barcode));
	} catch (e) {
		logger.error("decode_barcode: JSON.parse() " + e.toString());
		res.method = "decode_barcode";
		res.err = e.toString();
		return res;
	}

	if (err.errmsg !== '') {
		logger.error("decode_barcode: wDecodeShk^wrappers() " + e.toString());
		res.method = "decode_barcode";
		res.err = e.toString();
		return res;
	}

	try {
		/* get the global */
		result = JSON.parse(globals.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("decode_barcode: JSON.parse() " + e.toString());
		res.method = "decode_barcode";
		res.err = e.toString();
		return res;
	}

	if (result.errmsg != "") {
		logger.error("decode_barcode: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "decode_barcode";
		res.err = result.errmsg;
		return res;
	}	
	
	var glbname = get_globname(result.glvn);
	var glbsubs = get_globsubs(result.glvn);

	var node = { "global" : glbname, "subscripts" : glbsubs };
	var header = gtm.get(node).data;
	/* traverse global */
	glbsubs.push('');
	var node = { "global" : glbname, "subscripts" : glbsubs };
	var info = {};
	while ((node = gtm.order(node)).result) {
		var sub = node.result;
		var sdata = gtm.get(node).data;
		var arr = sdata.split('#');
		var key = arr[0], value = arr[1];
		info[key] = value;

		node.subscripts.pop();
		node.subscripts.push(sub);
	}
	
	var data = {};
	data.name = header;
	data.info = info;	
	
	res.method = "decode_barcode";
	res.err = null;
	res.data = data
	return res;
}

/* report on material storage and list of packages */
function get_material_storage(data) {
	var operation = data.operation == "" ? "" : "+";
	var context = data.id_material + "#" + data.id_owner + "#" + operation;
	var filter = data.filter.join(',');
	var res = {}, result;
	var list_info = [];
	var err;
	/* these numbers define filter id at the system 
	 */
	var F_NONE = 1,
            F_BATCH = 2,
            F_PORTION = 3,
            F_BP = 4,
	    F_MOL = 5,
            F_MB = 6,
            F_MP = 7,
            F_MBP = 8;

	var filterId = F_NONE; 

	switch (filter.length > 0) {
	case /((MOL|batch|portion)[,]?){3}/.test(filter):
        	filterId = F_MBP;
        	break;
	case /((MOL|batch)[,]?){2}/.test(filter):
        	filterId = F_MB;
       		break;
	case /((MOL|portion)[,]?){2}/.test(filter):
        	filterId = F_MP;
        	break;
	case /((batch|portion)[,]?){2}/.test(filter):
        	filterId = F_BP;
        	break;
	case /(MOL|batch|portion){1}/.test(filter):
        	switch (true) {
		case /MOL/.test(filter):
			filterId = F_MOL;
			break;
		case /batch/.test(filter):
			filterId = F_BATCH;
			break;
		case /portion/.test(filter):
			filterId = F_PORTION;
			break;
		}
		break;
	default:
		logger.error("get_material_storage: unknown filter");
		res.method = "get_material_storage";
		res.err = "unknown filter";
		return res;
	}

	var node = { "key" : data.key, 
		     "context" : context, 
		     "doctype" : data.type, 
		     "docid" : data.num };

	try {	
		err = JSON.parse(globals.function("wGetMaterialStorage^wrappers",
						data.key, context, data.type, data.num));
	} catch (e) {
		logger.error("get_material_storage: JSON.parse() " + e.toString());
		res.method = "get_material_storage";
		res.err = e.toString();
		return res;
	}

	if (err.errmsg != '') {	
		logger.error("get_material_storage: wGetMaterialStorage^wrappers() " + err.errmsg);
		res.method = "get_material_storage";
		res.err = err.errmsg;
		return res;
	}
	
	try {
		/* get the global */
		result = JSON.parse(globals.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("get_material_storage: JSON.parse() " + e.toString());
		res.method = "get_material_storage";
		res.err = e.toString();
		return res;	
	}

	if (result.errmsg != '') {
		logger.error("get_material_storage: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "get_material_storage";
		res.err = result.errmsg;
		return res;
	}	
	
	var glbname = get_globname(result.glvn);
	var glbsubs = get_globsubs(result.glvn);
	/* after we found node index 
	 * we can get data placed under that node
	 * save index of node */
	var idx_index = glbsubs.length;
	glbsubs.push(filterId);
	glbsubs.push('');	
	
	var node = { "global" : glbname, "subscripts" : glbsubs };
		
	while ((node = gtm.order(node)).result) {
		var sub = node.result;
		var o = gtm.get(node);
		var idstr = sub;
		// var idstr = o.subscripts[o.subscripts.length - 1];
		
		/* id_department#id_MOL#id_portion */
		var ids;
		var obj = {};
	
		switch (filterId) {
		case F_NONE:
			obj.id_department = idstr;
			break;
		case F_BATCH:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_batch = ids[1];
			break;
		case F_PORTION:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_portion = ids[1];
			break;
		case F_BP:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_batch = ids[1];
			obj.id_portion = ids[2];
			break;
		case F_MOL:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_mol = ids[1];
			break;
		case F_MB:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_mol = ids[1];
			obj.id_batch = ids[2];
			break;
		case F_MP:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_mol = ids[1];
			obj.id_portion = ids[2];
			break;
		case F_MBP:
			ids = idstr.split('#');
			obj.id_department = ids[0];
			obj.id_mol = ids[1];
			obj.id_batch= ids[2];
			obj.id_portion = ids[3];
			break;
		default:
			logger.error("get_material_storage: unknown id");
			res.method = "get_material_storage";
			res.err = "uknown filter id";
			return res;
		}	
	
		/* кол-во россыпью#кол-во упакованых#кол-во общее */
		var counts = o.data.split('#');
		var c_not_packed = counts[0],
		    c_packed = counts[1],
		    c_total = counts[2];

		obj.count_not_packaged_material = c_not_packed;
		obj.count_packaged_material = c_packed;
		obj.count_material = c_total;
		/* put all object to the list */
		list_info.push(obj);

		node.subscripts.pop();
		node.subscripts.push(sub);
	} 

	/* next node for traversal
	 * get list of packages 
         */
	glbsubs[idx_index] = '9';
	node = { "global" : glbname, "subscripts" : glbsubs };
	var packs = {};
	while ((node = gtm.order(node)).result) {
		var sub = node.result;
                var o = gtm.get(node);
        	/* sub is a package id */
                var id_pack = sub; 
                packs[id_pack] = o.data;
		node.subscripts.pop();
		node.subscripts.push(sub);
	} 

	var data = {}
	data.report = list_info;
	data.pack_list = packs;
	
	res.method = "get_material_storage";
	res.err = null;
	res.data = data;

	return res;
}

function scantodb(data) {
	// включить проверку на типы штрих кодов
        // key - session key 
        // ob - объект (XN,XP,etc)(ТТН,ПО,и т.д.)
        // ex - идентификатор экзмепляра объекта
        // shk - штрих-код
        // nr - признак проверка, передается от клиента
        // fms - если nr=0, то может быть fms
	var args = {}, res = {};

	var result, obj, err;

	var material_code_from_scan = parseInt(data.barcode.substring(10,17));
	
	args.key = data.key;
	args.ob = data.type;
	args.ex = data.num;
	args.shk = data.barcode;
	args.nr = data.nr;

	try {
		err = JSON.parse(globals.function("wScan2Db^wrappers",
						data.key, data.type, data.num, data.barcode, data.nr));
	} catch (e) {
		logger.error("scantodb: JSON.parse() " + e.toString());
		res.method = "scantodb";
		res.err = e.toString();
		return res;
	}

	if (err.errmsg != "") {
		logger.error("scantodb: wScan2Db^wrappers() " + err.errmsg);
		res.method = "scantodb";
		res.err = err.errmsg;
		return res;
	}

	try {
		/* get the global */
		result = JSON.parse(globals.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("scantodb: JSON.parse() " + e.toString());
		res.method = "scantodb";
		res.err = e.toString();
		return res;
	}

	if (result.errmsg != "") {
		logger.error("scantodb: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "scantodb";
		res.err = result.errmsg;
		return res;
	}	
	
	var glbname = get_globname(result.glvn);
	var glbsubs = get_globsubs(result.glvn);	
	
	var node = { "global" : glbname, "subscripts" : glbsubs };
	/* number of packages in the document  */
	var count_upac_fact_key = "count_upac_fact";
	var count_upac_fact = gtm.get(node).data;

	glbsubs.push('1');
	glbsubs.push('');

	var list = [];
	var node = { "global" : glbname, "subscripts" : glbsubs };
	
	while ((node = gtm.order(node)).result) {
		var sub = node.result;
		// id материала # id владельца # признак материала в эксплутатации
		var arr = sub.split('#');
		var id_material = arr[0];
		var id_owner = arr[1];
		var operation;

		if (id_owner != "")	
			operation = "yes";
		else 
			operation = "no";
		
		if (material_code_from_scan == id_material) {
			var data = gtm.get(node).data;
			var list_values = data.split('#');
		
			list_values.push(material_code_from_scan);
			list_values.push(id_owner);
			list_values.push(operation);
	
			var obj = {};
			var list_keys = [ "kod",
				  	  "ostatok_plan",
				  	  "fact",
				  	  "name",
				  	  "id",
				  	  "id_owner",
				  	  "operation" ];
			
			obj[count_upac_fact_key] = count_upac_fact;

			for (var i = 0; i < list_values.length - 1; i++)
				obj[list_keys[i]] = list_values[i];
				list.push(obj);
			}
		/* update subscripts */
		node.subscripts.pop();
		node.subscripts.push(sub);
	}
	res.method = "scantodb";
	res.err = null;
	res.data = list[0];
	return res;
}	
/*
function xshema_function(method, data) {
	var res = {};

	var temp = new globals.GlobalNode('%zewdTemp', ["WebService", data.token])
	console.log("temp ",temp);
	temp.$("input")._setDocument(data);
	var err = globals.function('Start^ZAPI000', data.token);	
	
	if (err != "") {
		var errmsg = decode(err);
		temp._delete();
		res.method = method;
		res.err = errmsg;
		return res;
	}
	var dataObj = temp.$("output")._getDocument();
	temp._delete();

	res.method = method;
	res.data = dataObj;
	res.err = null;
	return res;
}
*/
module.exports.init = init;
module.exports.login = login;
module.exports.get_availdoc = get_availdoc;
module.exports.get_infodoc = get_infodoc;
module.exports.get_package_content = get_package_content;
module.exports.decode_barcode = decode_barcode;
module.exports.get_material_storage = get_material_storage;
module.exports.scantodb = scantodb;
module.exports.terminate = terminate;
