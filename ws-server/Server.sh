#!/bin/sh -x

if [ "x$(whoami)" = "xroot" ]; then
  echo "#"
  echo "# $0 should not be run as root. Because 'root' does not 'node' binaries in its execution path."
  echo "# Use systemctl start xgateway.service"
  echo "#     systemctl stop xgateway.service"
  echo "#"
  exit 1
fi

WDIR=$PWD
PROG=$WDIR/Server.js
PIDFILE=$WDIR/pidfile
NOHUPFILE=$WDIR/nohup.out
PROFILE=$WDIR/.xgateway_profile

# If run in non-interractive shell (like systemd service executable in ExecStart= directive)
# 'node' binaries does not show up in the execution path.
# We explicitly pass this variable through Environment= directive in the systemd service
if test -z "$NODE" && test -n "$PS1"; then 
  # 'node' binaries available in the interractive shell
  export NODE=$(which node)
  if test -z "$NODE"; then
    echo "ERROR: 'node' binaries did not found in execution path"
    exit 1
  fi
elif test -z "$NODE" && test -z "$PS1"; then
  echo "ERROR: 'node' binaries available only in interractive shell."
  exit 1
fi

case $1 in
start)
  if test -f $PIDFILE; then
     read pid < $PIDFILE
     if test -n "$pid"; then
       pid=$(ps axo pid | grep -w $pid)
       if [ -n "$pid" ] && [ "x$(ps axo pid,cmd | grep -w $pid | grep -o $PROG)" = "x$PROG" ]; then
         echo "$PROG already running. Pid $pid."
         exit 1
       fi
     else rm -v $PIDFILE; fi
  fi
  . $PROFILE ; nohup $NODE $PROG > $NOHUPFILE 0<&- 2>&1 &
  echo $! > $PIDFILE
  echo "$PROG is running -- ($!)"
  ;;
stop)
  if test -f $PIDFILE; then
    read pid < $PIDFILE
    if test -n "$pid"; then
      if [ -n "$pid" ] && [ "x$(ps axo pid,cmd | grep -w $pid | grep -o $PROG)" = "x$PROG" ]; then
        kill -KILL $pid
        echo "Process $pid was killed"
        rm -v $PIDFILE
        exit 0 
      fi
    else rm -v $PIDFILE; fi
  fi
  # kill processes executed from current working directory
  kill -KILL $(ps axo pid,cmd | grep node | grep $WDIR | awk '{ print $1 }') 2>/dev/null 
  exit 0
  ;;
*)
  echo "./Server.sh start|stop"
  ;;
esac
