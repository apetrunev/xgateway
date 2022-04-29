var cp = require("child_process");
var events = require("events");
var log4js = require("log4js");
var assert = require("assert");
var nconf = require("nconf");

/* load config file */
nconf.file({ file : "config.json" });

var serverLog = nconf.get("logger:serverLogfilePath");
var logfileSize = nconf.get("logger:logfileSize");

log4js.configure({
        "appenders": [
                {
                        "type" : 'file',
                        "filename" : serverLog,
                        "category" : 'Server.js',
                        "maxLogSize" : logfileSize,
                        "backups": 3
                },
        ]
});

var logger = log4js.getLogger('Server.js');

/* number of db workres */
var childPoolSize = nconf.get("childPoolSize"),
    childMax = nconf.get("childMax"),
    childPath = nconf.get("childPath"),
    childNextId = 0,
    childUnavailableTimeLimit = nconf.get("childUnavailableTimeLimit"); /* ms */
    
var childOptions = {
	env: process.env, 
};

var queue = [];
/* contains child processes */
var processes = {};
var queueEvents = new events.EventEmitter();

var initMessageQueue = function () {
	queueEvents.on("processQueue", processQueue);
};

var addMessageToQueue = function (message) {
	queue.push(message);
	queueEvents.emit("processQueue");
};
	
/* find available process if exists */
var getChildProcess = function () {
	var pid;
	for (pid in processes) {
		if (processes[pid].isAvailable) {
			processes[pid].isAvailable = false;
			processes[pid].time = new Date().getTime();
			return pid;
		}
	}
	return false;
};

var sendRequestToChildProcess = function (qMessage, pid) {
	var process;
	if (processes[pid]) {
		process = processes[pid];
		/* message came from a webscoket client */
		if (qMessage.wsId) {
			process.wsId = qMessage.wsId;
			/* do not pass it to child process */
			delete qMessage.wsId;
		}
		try {
			process.send(qMessage);	
		} catch (e) {
			/* process became unavailble 
			 * delete from process pool	
			 */
			childPoolSize--;
			if (process.wsId) {
				qMessage.wsId = process.wsId;
				delete process.wsId;
			}
			delete processes[pid];
			/* enque message one more time */
			addMessageToQueue(qMessage);
			logger.error("process.send(): " + e.toString());
		}
	}
	process = null;
};

/* scheduller*/	
var processQueue = function () {
	/* start queue processing */
	var pid = (queue.length !== 0);

	while (pid) {
		/* find available process */
		pid = getChildProcess();
		if (pid) {
			/* fetch message from queue and send to worker process */
			var qMessage = queue.shift();
			sendRequestToChildProcess(qMessage, pid);
			qMessage = null;
		}
				
		if (queue.length === 0)
			pid = false;
	}
	/* not enough child processes to handle messages */
	if (queue.length > 0) {
		var trigger = false;
		if (childPoolSize < childMax) {
			var pid = _startChildProcess(childNextId++);
			childPoolSize++;
			trigger = true;
			pid = null;
		} else {
			var proc;
			var dur;

			for (var pid in processes) {
				proc = processes[pid];
				dur = new Date().getTime() - proc.time;
			
				if (!proc.isAvailable && childPoolSize > 1 && dur > childUnavailableTimeLimit) {
					/* get rid of hanged process */ 
					proc.kill('SIGKILL');
					childPoolSize--;
					delete processes[pid];
					trigger = true;
				}				    	
			}
			dur = null;
			proc = null;
		}
		/* schedule queue processing one more time */
		if (trigger) {
			setTimeout(function scheduleQueue() {
				queueEvents.emit("processQueue");
			}, 400);
		}
	}
	pid = null;
};

var findWsById = function (wsId) {
	for (var i = clients.length - 1; i >= 0; i--) {
		if (wsId == clients[i].id)
			return i;
	}
	return -1;
};

var iksMethodHandler = function (cMessage) {
	var pid = cMessage.pid;
	var process;
	/* such process exists */
	if (processes[pid]) {
		process = processes[pid];
		/* id of client that issued the message */
		var widx = findWsById(process.wsId);
		if (widx >= 0) {
			/* get client's ws object */
			var ws = clients[widx];
			try {
				if (ws.readyState == ws.OPEN)
					ws.send(JSON.stringify(cMessage));
			} catch (e) {
				logger.error("ws.send(): " + e.toString());
			}
			ws = null;
		}
		widx = null;	
	}	
	delete process.wsId;
	process.isAvailable = true;
	process = null;
	pid = null;
};

var unknown = function (cMessage) {
	logger.error("unknown method." + JSON.stringify(cMessage));
	cMessage = null;
};

var childMessageHandlers =  {
	'login' : iksMethodHandler,
	'scantodb' : iksMethodHandler,
	'get_availdoc' : iksMethodHandler,
	'get_infodoc' : iksMethodHandler,
	'get_material_storage' : iksMethodHandler,
	'get_package_content' : iksMethodHandler,
	'decode_barcode' : iksMethodHandler,
	'unknown' : unknown,	
	'child_start' : function (cMessage) {
		/* child is started and awating initialization */
		var pid = cMessage.pid;
		var process;
		if (processes[pid]) {
			process = processes[pid];
			process.started = true;
			try {
				process.send({ "method": "child_init", "data": null, "err" : null });
			} catch (e) {
				/* process became unavailable */
				delete processes[pid];
				childPoolSize--;
				logger.error("process.send(): " + e.toString());
			}
		}
		pid = null;
		process = null;
	},
	'child_init' : function (cMessage) {
		var pid = cMessage.pid;
		var process;
		if (processes[pid]) {
			process = processes[pid];
			if (cMessage.err) {
				/* process is unable to initialize
				 * delete it and log error message
				 */
				logger.error("child process: " + cMessage.err + ". Pid " + pid + ".");
				process.kill('SIGKILL');
				logger.info("child process: process terminated. Pid " + pid + ".");
				childPoolSize--;
				delete processes[pid];
			} else {
				process.isAvailable = true;
			}
		}
		pid = null;
		process = null;
	},
	'memory_usage' : function (cMessage) {
		var pid = cMessage.pid;
		const mb = 1000000;
        	const gb = 1000000000;
		var max_usage = 200*mb;
		var mem_usage = cMessage.data.rss;
		var process;
		
		if (processes[pid]) {
			process = processes[pid];
			if (mem_usage > max_usage) {
				logger.info("Process " + pid + " reached memory limit. Closing.");
				childPoolSize--;
				process.kill('SIGKILL');
				delete processes[pid];
				if (childPoolSize < 2) {
					var pid = _startChildProcess(childNextId++);
					childPoolSize++;
					pid = null;
				}
			} else {
				process.isAvailable = true;
			}	
		}
		pid = null;
		mem_usage = null;
		process = null;
	}
};

var _startChildProcess = function (procId) {
	/* does not clone current process */
	var pchild = cp.fork(childPath, [], childOptions);
	var pid = pchild.pid;
	/* save process */	
	processes[pid] = pchild;
	var thisProcess = processes[pid];		
	thisProcess.isAvailable = false;
	thisProcess.time = new Date().getTime();
	thisProcess.started = false;
	thisProcess.procId = procId;
	/* messages from child */
	thisProcess.on("message", function processMessageHandler(message) {
		var pid = message.pid;
		/* such process exist */
		if (processes[pid]) {
			if (childMessageHandlers[message.method]) {
				childMessageHandlers[message.method](message);
			} else {
				childMessageHandlers["unknown"](message);	
			} 
		}
		pid = null;
		message = null;
	})
	pchild = null;
	thisProcess = null;
	return pid;
};

var startChildPool = function () {
	var pid;
	for (var i = 1; i <= childPoolSize; i++) {
		pid = _startChildProcess(i);
	}
	/* save next available id */
	childNextId = i;
	pid = null;
};

var M_UNKNOWN = 0,
    M_LOGIN = 1,
    M_SCANTODB = 2,
    M_GET_AVAILDOC = 3,
    M_GET_INFODOC = 4,
    M_GET_MATERIAL_STORAGE = 5,
    M_GET_PACKAGE_CONTENT = 6,
    M_DECODE_BARCODE = 7,
    M_PONG = 8,
    M_PING = 9;

var _rpcMethods = {
	'login' : M_LOGIN,
	'scantodb' : M_SCANTODB,
	'get_availdoc' : M_GET_AVAILDOC,
	'get_infodoc' : M_GET_INFODOC,
	'get_material_storage' : M_GET_MATERIAL_STORAGE,
	'get_package_content' : M_GET_PACKAGE_CONTENT,
	'decode_barcode' : M_DECODE_BARCODE,
	'pong' : M_PONG,
	'ping' : M_PING,
};

var rpcMethods = function (method) {
	if (_rpcMethods[method])
		return _rpcMethods[method];
	return M_UNKNOWN;
};

/* initialize keepalive responses */
const ping = JSON.stringify({ "method" : "ping", "err" : null, "data" : null });
const pong = JSON.stringify({ "method" : "pong", "err" : null, "data" : null });

/* array of `ws' objects */
var clients = [];

var uniqId = function () {
	return '_' + Math.random().toString(36).substr(2, 9);
};

var connectionHandler = function connection(ws) {
	ws.id = uniqId();
	ws.isAlive = true;

	clients.push(ws);

	ws.on('pong', function wsPong() {
		ws.isAlive = true;
	});
	
	ws.on('message', function wsMessage(message) {
		var messageObj;
                try {
                        messageObj = JSON.parse(message);
			messageObj.wsId = ws.id;
		
			switch (rpcMethods(messageObj.method)) {
			case M_LOGIN:
			case M_SCANTODB:
			case M_GET_AVAILDOC:
			case M_GET_INFODOC:
			case M_GET_MATERIAL_STORAGE:
			case M_GET_PACKAGE_CONTENT:
			case M_DECODE_BARCODE:
				addMessageToQueue(messageObj);
				break;
			/* keepalive messages */
			case M_PONG:
				ws.send(ping);
				break;
			case M_PING:
				ws.send(pong);
				break;
			default:
				logger.error("unknown method: " + messageObj.method);
				break;
			}
		} catch (e) {
                        logger.error("ws.onmessage: " + e.toString());
                }
		messageObj = null;
        });

        ws.on('error', function wsError(err) {
		/* on error connection is terminated after 30 seconds timeout
		 * we don't need to wait too much
		 */
		logger.error(err.toString() + ". Connection closed.");
		try {
			ws.terminate();
		} catch (e) {
			logger.error("wsError(): " + e.toString());
		}
        });
	
	ws.on('close', function wsClose(code, message) {
		logger.info("closing connection " + code + " " + message);
	});
};

/* catch server error */ 
var error = function (err) {
	if (err.errno === "EADDRINUSE")
		console.log(err.toString());
	logger.error(err.toString());
};

var close = function (code, message) {
	logger.info("server is terminating..." + code + " " + message);
};

var minute = 60000; /* ms */
var second = 1000;

var do_nothing = function () {};

var clearUnavailableSockets = function () {
	for (var i = clients.length - 1; i >= 0; i--) {
		/* search for unavailable clients */
		var ws = clients[i];
		try {
			/* client did not reply */
			if (ws.isAlive === false) {
				delete ws.id;
				clients.splice(i, 1);
				if (ws.readyState === ws.OPEN || 
				    ws.readyState === ws.CONNECTING) {
					var addr = ws.upgradeReq.connection.remoteAddress;
					logger.info("Client " + addr + " is unavailable. Closing.");
					addr = null;
					ws.terminate();
				}
			} else {
				/* client has replied */
				ws.isAlive = false;
				ws.ping('', false, do_nothing);
			}
		} catch (e) {
			logger.error("clearUnavailableSockets(): " + e.toString());
			delete ws.id;
			clients.splice(i, 1);
		}
		ws = null;
	}
};

var socketWatcher = function () {
	clearUnavailableSockets()
        var t = setTimeout(function () {
                socketWatcher();
        }, 20*second);
};

var showMemoryUsage = function () {
	var msgObj = { "method" : "memory_usage", "err" : null, "data" : null }; 
	addMessageToQueue(msgObj);
	msgObj = null;
};

var memoryLeakWatcher = function () {
	showMemoryUsage();
	var t = setTimeout(function () {
		memoryLeakWatcher();
	}, 10*second);	
};

var serverMemoryUsageWatcher = function () {
	var mem_usage = process.memoryUsage();
	logger.info("Rss: " + mem_usage.rss + ", heapTotal: " + mem_usage.heapTotal + ", heapUsed: " + mem_usage.heapUsed);
	mem_usage = null;
	var t = setTimeout(function () {
		serverMemoryUsageWatcher();
	}, 5*minute);	
};

var startServer = function () {
	initMessageQueue();
	startChildPool();

	var wssCtx = {};
	wssCtx.port = nconf.get("serverPort"); 
	wssCtx.perMessageDeflate = false;
	wssCtx.clientTracking = false;

	var wss = new require("ws").Server(wssCtx);
	wss.on('connection', connectionHandler);
	wss.on('close', close);
	wss.on('error', error);
	
	console.log("Listenning on port " + wssCtx.port + "...");

	socketWatcher();
	memoryLeakWatcher();
	serverMemoryUsageWatcher();
};

startServer();
