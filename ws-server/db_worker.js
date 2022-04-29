var log4js = require('log4js');
var nconf = require('nconf');

// var iks = require('./cache_iks_functions');
var iks = require('./gtm_iks_functions');

nconf.file({ "file" : "config.json" });

var workerLog = nconf.get("logger:workerLogfilePath");
var logfileSize = nconf.get("logger:logfileSize");

/*
 * LOGGER
 *
 */

log4js.configure({
        "appenders": [
                {
                        "type" : 'file',
                        "filename" : workerLog,
                        "category" : 'gtm_worker.js',
                        "maxLogSize" : logfileSize,
                        "backups": 3 
                }
        ]
});

var logger = log4js.getLogger('gtm_worker.js');

/* handle message from parent process */
var messageHandlers =  {
	/* callbacks */	
	"child_init": function () {
		var ret = iks.init();
		if (ret && ret.ok !== 1) {
			logger.error("child_init: " + ret.errorMessage + ". " + ret.errorCode);
			process.send({
				pid: process.pid,
				err: ret.errorMessage,
				method: "child_init",
				data: null
			});
			ret = null;
			return;
		}
		process.send({
			pid: process.pid,
			err: null,
			method: "child_init",
			data: null
		});
	},
	
	"memory_usage" : function () {
		process.send( {
			pid: process.pid,
			err: null,
			method : "memory_usage",
			data : process.memoryUsage()
		});	
	},

	"login": function (data) {
		var retObj = iks.login(data);
		retObj.pid = process.pid
		process.send(retObj);
		retObj = null;
	},
	
	"scantodb": function (data) {
		var retObj = iks.scantodb(data);
		retObj.pid = process.pid;
		process.send(retObj);
		retObj = null;
	},

	"get_availdoc": function (data) {
		var retObj = iks.get_availdoc(data);
		retObj.pid = process.pid;
		process.send(retObj);	
		retObj = null;
	},

	"get_infodoc": function (data) {
		var retObj = iks.get_infodoc(data);
		retObj.pid = process.pid;
		process.send(retObj);
		retObj = null;
	},

	"get_material_storage": function (data) {
		var retObj = iks.get_material_storage(data);
		retObj.pid = process.pid;
		process.send(retObj);
		retObj = null;
	},

	"get_package_content": function (data) {
		var retObj = iks.get_package_content(data);
		retObj.pid = process.pid;
		process.send(retObj);
		retObj = null;
	},

	"decode_barcode": function (data) {
		var retObj = iks.decode_barcode(data);
		retObj.pid = process.pid;
		process.send(retObj);
		retObj = null;
	}
};

function terminate(signame) {
	iks.terminate();
	logger.error(signame + " received. Pid " + process.pid + ". Shuting down.");
	process.exit();
}

function exit() {
	iks.terminate();
	logger.info("Process exiting. Pid " + process.pid + ".");
	process.exit();
}

process.on("message", function (messageObj) {
	var method = messageObj.method;
	if (messageHandlers[method]) {
		try {
			messageHandlers[method](messageObj.data);
		} catch (e) {
			logger.error(e.toString());
			process.send({ "method" : method, "err" : e.toString() });
		}
	} else {
		/* notify parent on unknow method */
		logger.error("error: unknown method " + method);
		process.send({
			pid: process.pid,
			err: "unknown method",
			method: "unknown",
			data: null
		});
	}
	method = null;
});

/* close gtm on exit */
process.on("exit", exit);
process.on("disconnect", exit);
process.on("SIGINT", terminate);
process.on("SIGTERM", terminate);

/* tell the parent we have started and awaiting for initilization */
process.send({ 
	pid: process.pid,
	err: null,
	method: "child_start",
	data: null
});
