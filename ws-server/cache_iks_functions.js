var crypto = require('crypto');
var log4js = require('log4js');
var cachedb = require('cache');
var nconf = require("nconf");

var cache = new cachedb.Cache();
var cache_ctx = {};
var logger;

var defaultCacheIpAddress = "127.0.0.1";
var defaultCacheTcpPort = "1972";
var defaultCacheUsername = "_SYSTEM";
var defaultCachePassword = "SYS"
var defaultCacheNamespace = "IKSTEST";
var defaultCachePath = "/usr/cache/mgr";

var defaultWorkerLog = "./server-iks-db-worker.log";
var defaultLogfileSize = "400000";

function init() {
	/* load config file */
	nconf.file({ "file" : "config.json" });
	/* init logger paramters */
	workerLog = nconf.get("logger:workerLogfilePath") || defaultWorkerLog;
	logfileSize = nconf.get("logger:logfileSize") || defaultLogfileSize;
 	/* init cache parameters */
	cache_ctx.id_address = nconf.get("cache:ip_address") || defaultCacheIpAddress;
	cache_ctx.tcp_port = nconf.get("cache:tcp_port") || defaultCacheTcpPort;
	cache_ctx.username = nconf.get("cache:username") || defaultCacheUsername;
	cache_ctx.password = nconf.get("cache:password") || defaultCachePassword;
	cache_ctx.namespace = nconf.get("cache:namespace") || defaultCacheNamespace;
	cache_ctx.path = nconf.get("cache:path") || defaultCachePath;
	/* connect to cache */
	var ret = cache.open(cache_ctx);
	if (ret && ret.ok !== 1)
		return ret;
	/* init logger */
	log4js.configure({
        	"appenders": [
                	{
                        	"type" : 'file',
                        	"filename" : workerLog,
                        	"category" : 'cache_worker.js',
                        	"maxLogSize" : logfileSize,
                        	"backups": 3 
			}
		]
	});
	logger = log4js.getLogger('cache_worker.js');
	return ret;
}

function terminate() {
	cache.close();
}

/*
 * IKS FUNCTIONS
 *
 */

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

/* construct global for passing as an argument to M function: ^GLB(sub1,sub2,..,subN)*/
function construct(glvn,subs) {
        var glb = "^" + glvn;
        var subscripts = [];

        for (var i = 0; i < subs.length; i++) {
                subscripts[i] = "\"" + subs[i] + "\"";
        }

        return glb + "(" + subscripts.join() + ")";
}

/* 
 * special version of `get' function
 * node has the form of  { "global": glbname, "subscripts": glbsub }
 */
cache._get = function(node) {
	var mGlb, obj;
	
	mGlb = construct(node.global, node.subscripts);
	obj = JSON.parse(cache.function("wGet^wrappers", mGlb));
	return obj;
};

function login(data) {
	var res = {}, err;
        var sessionId = crypto.randomBytes(20).toString('hex');
	/* after success login we get uniq key */
	try {
        	err = JSON.parse(cache.function("wLogin^wrappers", sessionId, data.id, data.password, data.private_pass));
	} catch (e) {
		logger.error("login: JSON.parse(): " + e.toString());
		res.method = "login";
		res.err = "login: JSON.parse(): " + e.toString();
		return res;
	}
	/* if error occured send error message to client */
        if (err.errmsg && err.errmsg !== "") {
		/* log error */
                logger.error("login: wLogin^wrappers " + err.errmsg);
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

function get_availdoc(data) {
        var res = {};
	var err, result, glbname, glbsubs;
	try {
		/* get temporary global (per session node where functions put its results) */
		result = JSON.parse(cache.function("wGetSpJs^wrappers", data.key));	
	} catch (e) {
		logger.error("get_availdoc: JSON.parse() " + e.toString());
		res.method = "get_availdoc";
		res.err = e.toString();
		return res;
	}

	/* check for errors */
	if (result.errmsg && result.errmsg !== "") {
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
		err = JSON.parse(cache.function("wGetAvailDoc^wrappers", data.key));
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
	var docs = {};       
	/* get list of docs from the global */    
	
	while ((node = cache.order(node)).result) {
		/* parse data string */
		try {
			var data = cache._get(node).data;
		} catch (e) {
			logger.error("get_availdoc: cache._get(): " + e.toString());
			res.method = "get_availdoc";
			res.err = e.toString();
			return res;
		}
                /* parsing docs string */
		var arr = data.split('#');
                docs[arr[1]] = arr[0];
	}
        /* success */
        res.method = "get_availdoc";
        res.err = null;
        res.data = docs
	return res;
}

function get_infodoc(data) {
	var err, result, res = {};
	var glbname, glbsubs, node;
	/* get_doc returns data to uniq per-session global */
	try {
		err = JSON.parse(cache.function("wGetDoc^wrappers", data.key, data.type, data.num));
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
		result = JSON.parse(cache.function("wGetSpJs^wrappers", data.key));
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
	node = { "global" : glbname, "subscripts" : glbsubs };
	try {
		var count_upac_fact = cache._get(node).data; 
	} catch (e) {
		logger.error("get_infodoc: cache._get()" + e.toString());
		res.method = "get_infodoc";
		res.err = e.toString();
		return res;
	}
	/* we have three nodes : 1, 2, 3
	 * traverse these in order */
	glbsubs.push('1');
	/* remember the node index */
	var idx = glbsubs.length - 1;
	/* push empty node for traversal*/
	glbsubs.push('');
	/* get details about materials */
	var material = [];
	node = { "global" : glbname, "subscripts" : glbsubs };
	while ((node = cache.order(node)).result) {
		/* sub contain information in the form of id_material#id_owner#operation */
                var sub = node.result;

                var arr = sub.split('#');
                var id_material = arr[0],
                    id_owner = arr[1],
                    operation = arr[2] == "" ? "" : "+";	
		
		try {
			var data = cache._get(node).data;
		} catch (e) {
			logger.error("get_infodoc: cache._get():" + e.toString());
			res.method = "get_infodoc";
			res.err = e.toString();
			return res;
		}
		
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
		for (var i = 0; i < values.length; i++) {
			item[keys[i]] = values[i];
		}

		material.push(item);	
	}
	/* change node index */
	glbsubs[idx] = '2';
	/* get document full info */
	node = { "global" : glbname, "subscripts" : glbsubs };
	var full_info = {};
	while ((node = cache.order(node)).result) {
		try {
			var data = cache._get(node).data;
		} catch (e) {
			logger.error("get_infodoc: cache._get(): " + e.toString());
			res.method = "get_infoldoc";
			res.err = e.toString();
			return res;
		}
		/* key#value pairs */
		var arr = data.split('#');
		var key = arr[0], value = arr[1];
		full_info[key] = value;
	}
	glbsubs[idx] = '3';
	/* get short info */
	node = { "global" : glbname, "subscripts" : glbsubs };
	var short_info = {};
	while ((node = cache.order(node)).result) {
		try {
			var data = cache._get(node).data;
		} catch (e) {
			logger.error("get_infodoc: cache._get(): " + e.toString());
			res.method = "get_infodoc";
			res.err = e.toString();
			return res;
		}

		var arr = data.split('#');
		var key = arr[0], value = arr[1];
		short_info[key] = value;
	}
	data = {};
	/* construct object to return */
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
	var err; 
	var result, res = {};

	try {
		err = JSON.parse(cache.function("wSpecVd^wrappers", data.key, data.barcode));
	} catch (e) {
		logger.error("get_package_content: JSON.parse() " + e.toString());
		res.method = "get_package_content";
		res.err = e.toString();
		return res;
	}

	if (err.errmsg !== '') {
		logger.error("get_package_content: wSpecVd^wrappers() " + result.errmsg);
		res.method = "get_package_content";
		res.err = result.errmsg;
		return res;		
	}

	try {	
		/* get the global */
		result = JSON.parse(cache.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("get_package_content: JSON.parse() " + result.errmsg);
		res.method = "get_package_content";
		res.err = result.errmsg;
		return res;
	}

	if (result.errmsg != "") {
		logger.error("get_package_content: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "get_package_content";
		res.err = result.errmsg;
		return res;
	}	
	
	glbname = get_globname(result.glvn);
	glbsubs = get_globsubs(result.glvn);

	var node = { "global" : glbname, "subscripts" : glbsubs };
	try {
		var pkg_name = cache._get(node).data;
	} catch (e) {
		logger.error("get_package_content: cache._get(): " + e.toString());
		res.method = "get_package_content";
		res.err = e.toString();
		return res;
	}
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
		var obj = {}, arr;

		arr = sub.split('#');
		obj["id_material"] = arr[0];
		obj["id_portion"] = arr[1];
		
		try {	
			var pkg_content = cache._get(node).data;
		} catch (e) {
			logger.error("get_package_content: cache._get(): " + e.toString());
			res.method = "get_package_content";
			res.err = e.toString();
			return res;
		}

		arr = pkg_content.split('#');
		obj["count"] = arr[0];
		obj["count_storage_unit"] = arr[1];
		
		primary.push(obj);
	}
	/* traverse secondary material */	
	glbsubs[idx] = '2';
	node = { "global" : glbname, "subscripts" : glbsubs };
	var secondary = [];
	while ((node = cache.order(node)).result) {
		var obj = {}, arr;
		var sub = node.result;
	
		arr = sub.split('#');
		obj["id_material"] = arr[0];
		obj["id_portion"] = arr[1];

		try {
			var pkg_content = cache._get(node).data;
		} catch (e) {
			logger.error("get_package_content: cache._get(): " + e.toString());
			res.method = "get_package_content";
			res.err = e.toString();
			return res;
		}

		arr = pkg_content.split('#');
		obj["count"] = arr[0];
		obj["count_storage_unit"] = arr[1];

		secondary.push(obj);	
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
	var err = {}, result, res = {}; 

	try {
		err = JSON.parse(cache.function("wDecodeShk^wrappers", data.key, data.barcode));
	} catch (e) {
		logger.error("decode_barcode: JSON.parse() " + e.toString());
		res.method = "decode_barcode";
		res.err = err.errmsg;
		return res;
	}

	if (err.errmsg !== '') {
		logger.error("decode_barcode: wDecodeShk^wrappers() " + err.errmsg);
		res.method = "decode_barcode";
		res.err = err.errmsg;
		return res;
	}

	try {
		result = JSON.parse(cache.function("wGetSpJs^wrappers", data.key));	
	} catch (e) {
		logger.error("decode_barcode: JSON.parse() " + e.toString());
		res.method = "decode_barcode";
		res.err = err.errmsg;
		return res;
	}

	if (result.errmsg != "") {
		logger.error("decode_barcode: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "decode_barcode";
		res.err = result.errmsg;
		return res;
	}	
	
	glbname = get_globname(result.glvn);
	glbsubs = get_globsubs(result.glvn);

	var node = { "global" : glbname, "subscripts" : glbsubs };
	var header = cache.get(node).data;

	/* traverse global */
	glbsubs.push('');
	var node = { "global" : glbname, "subscripts" : glbsubs };
	var info = {};

	while ((node = cache.order(node)).result) {
		try {
			var sdata = cache._get(node).data;
		} catch (e) {
			logger.error("decode_barcode: cache._get(): " + e.toString());
			res.method = "decode_barcode";
			res.err = e.toString();
			return res;
		}	

		var arr = sdata.split('#');
		var key = arr[0], value = arr[1];

		info[key] = value;
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
	var filter = data.filter;
	var res = {}, result;
	var list_info = [];
	var weights = [];
	
	weights["MOL"] = 3;
	weights["batch"] = 5;
	weights["portion"] = 7;
	
	/* filter weights */
	var W_MOL = 3,
	    W_BATCH = 5,
	    W_PORTION = 7,
	    W_MB = 8,   /* MOL + BATCH */
	    W_MP = 10,  /* MOL + PORTION */
	    W_BP = 12,  /* BATHC + PORTION */
	    W_MBP = 15, /* All three */ 
	    W_NONE = 0; /* default */

	var F_NONE = 1,
	    F_BATCH = 2,
	    F_PORTION = 3,
	    F_BP = 4,
	    F_MOL = 5,
	    F_MB = 6,
	    F_MP = 7,
	    F_MBP = 8;
	
	function weight(list) {
		var sum = 0;

		for (var i in list) {
			var key = list[i];
			sum += weights[key];
		}
		return sum;
	}

	var w = weight(filter)
	var filterId; 
	/* determine which filter we have */
	switch (w) {
	case W_NONE:
		filterId = F_NONE;
		break;
	case W_BATCH:
		filterId = F_BATCH;
		break;
	case W_PORTION:
		filterId = F_PORTION;
		break;
	case W_BP:
		filterId = F_BP;
		break;
	case W_MOL:
		filterId = F_MOL;
		break;
	case W_MB:
		filterId = F_MB;
		break;
	case W_MP:
		filterId = F_MP;
		break;
	case W_MBP:
		filterId = F_MBP;
		break;
	default:
		logger.error("get_material_storage(): unknown filter");
		res.method = "get_material_storage";
		res.err = "get_material_storage(): unknown filter";
		return res;
	}

	var node = { "key" : data.key, 
		     "context" : context, 
		     "doctype" : data.type, 
		     "docid" : data.num };
	try {
		var err;	
		err = JSON.parse(cache.function("wGetMaterialStorage^wrappers",
			      	      data.key, context, data.type, data.num));
	} catch (e) {
		logger.error("get_material_storage: JSON.parse() " + e.toString());
		res.method = "get_material_storage";
		res.err = e.toString();
		return res;
	}
	
	if (err.errmsg != '') {
		logger.error("get_material_storage:  wGetMaterialStorage^wrappers() " + err.errmsg);
		res.method = "get_material_storage";
		res.err = err.errmsg;
		return res;
	}
	
	try {
		/* get the global */
		result = JSON.parse(cache.function("wGetSpJs^wrappers", data.key));
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
	
	glbname = get_globname(result.glvn);
	glbsubs = get_globsubs(result.glvn);
	/* after we found node index 
	 * we can get data placed under that node
	 */
	var idx_index;
	/* save index of node */
	idx_index = glbsubs.length;
	glbsubs.push(filterId);
	glbsubs.push('');	
	
	node = { "global" : glbname, "subscripts" : glbsubs };
	while ((node = cache.order(node)).result) {
		try {
			var o = cache._get(node);
		} catch (e) {
			logger.error("get_material_storage: cache._get(): " + e.toString());
			res.method = "get_material_storage";
			res.err = e.toString();
			return res;
		}

		var idstr = o.subscripts[o.subscripts.length - 1];
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
			res.err = "get_material_storage: unknown id";
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
	}	

	/* next node contains a list of packages 
         */
	glbsubs[idx_index] = '9';
	node = { "global" : glbname, "subscripts" : glbsubs };
	var packs = {};
	while ((node = cache.order(node)).result) {
		try {		
			var o = cache._get(node); 
			var id_pack = o.result;
			packs[id_pack] = o.data;
		} catch (e) {
			logger.error("get_material_storage: cache._get(): " + e.toString());
			res.method = "get_material_storage";
			res.err = e.toString();
			return res;
		}
	}

	var data = {};
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
	var res = {}, err = {};
	var result, obj;

	material_code_from_scan = parseInt(data.barcode.substring(10,17));

	try {
		var err = JSON.parse(cache.function("wScan2Db^wrappers",
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

	/* get the global */
	try {
		result = JSON.parse(cache.function("wGetSpJs^wrappers", data.key));
	} catch (e) {
		logger.error("scantodb: JSON.parse() " + e.toString());
		res.method = "scantodb";
		res.err = e.toString();
		return res;
	}
	
	if (result.errmsg != '') {
		logger.error("scantodb: wGetSpJs^wrappers() " + result.errmsg);
		res.method = "scantodb";
		res.err = result.errmsg;
		return res;
	}	
	
	glbname = get_globname(result.glvn);
	glbsubs = get_globsubs(result.glvn);	
	
	var node = { "global" : glbname, "subscripts" : glbsubs };
	/* number of packages in the document  */
	var count_upac_fact_key = "count_upac_fact";

	try {
		var count_upac_fact = cache_.get(node).data;
	} catch (e) {
		logger.error("scantodb: cache._get(): " + e.toString());
		res.method = "scantodb";
		res.err = e.toString();
		return res;
	}
	
	glbsubs.push('1');
	glbsubs.push('');

	var list = [];
	var node = { "global" : glbname, "subscripts" : glbsubs };
	
	while ((node = cache.order(node)).result) {
		var sub = node.result;
		// id материала # id владельца # признак материала в эксплутатации
		var arr = sub.split('#');
		var id_material = arr[0],
		    id_owner = arr[1],
		    operation;

		if (id_owner != "")	
			operation = "yes";
		else 
			operation = "no";

		if (material_code_from_scan == id_material) {
			try {
				var data = cache._get(node).data;
			} catch (e) {
				logger.error("scantodb: cache._get(): " + e.toString());
				res.method = "scantodb";
				res.err = e.toString();
				return res;
			}

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
	}

	res.method = "scantodb";
	res.err = null;
	res.data = list[0];
	return res;
}	

module.exports.init = init;
module.exports.login = login;
module.exports.get_availdoc = get_availdoc;
module.exports.get_infodoc = get_infodoc;
module.exports.get_package_content = get_package_content;
module.exports.decode_barcode = decode_barcode;
module.exports.get_material_storage = get_material_storage;
module.exports.scantodb = scantodb;
module.exports.xshema_function = xshema_function;
module.exports.terminate = terminate;
