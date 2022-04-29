#!/bin/sh -u 

IKSGW_SERVER=$(pwd)
IKSGW_CPATH=${IKSGW_SERVER}/db_worker.js
IKSGW_SERVERLOG=${IKSGW_SERVER}/logs/server-iks.log
IKSGW_WORKERLOG=${IKSGW_SERVER}/logs/server-iks-db-worker.log

[ -f ${IKSGW_SERVERLOG} ] || touch ${IKSGW_SERVERLOG}
[ -f ${IKSGW_WORKERLOG} ] || touch ${IKSGW_WORKERLOG}

cat<<TMPL
{
	"serverPort" : 1339,
	"childPoolSize" : 8,
	"childMax" : 10,
	"childPath" : "${IKSGW_CPATH}",
	"childNextId" : 0,
	"childUnavailableTimeLimit" : 1000, 
	"logger" :  {
		"serverLogfilePath" : "${IKSGW_SERVERLOG}",
		"workerLogfilePath" : "${IKSGW_WORKERLOG}",
		"logfileSize" : 400000 
	},
	"gtm" : {},
	"cache" : {
		"id_address" : "127.0.0.1",
		"tcp_port" : "1972",
		"username" : "_SYSTEM",
		"password" : "SYS",
		"namespace" : "IKSTEST",
		"path" : "/usr/cache/mgr"
	}
}
TMPL
