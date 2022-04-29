#!/bin/sh

dir="$(pwd)"

root_cnf="$dir/cnf/root-ca.cnf"
root_csr="$dir/root-ca.csr"
root_crt="$dir/root-ca.crt"
root_key="$dir/private/root-ca.key"

sub_cnf="$dir/cnf/sub-ca.cnf"
sub_csr="$dir/sub-ca.csr"
sub_crt="$dir/sub-ca.crt"
sub_key="$dir/private/sub-ca.key"

server_cnf="$dir/cnf/server.cnf"

usage () {
	echo "./ca.sh init -- initialize root-ca dir and set permissions"
	echo "./ca.sh root -- generate root certificate and key"
	echo "./ca.sh sub  -- create subordinate authority"
	echo "./ca.sh server [basename] -- issue server certificate"
}

case $1 in
init)
	mkdir $dir 2>/dev/null
	cd $dir && mkdir certs db private 2>/dev/null
	chmod 700 $dir/private 
	touch $dir/db/index
	openssl rand -hex 16 > $dir/db/serial
	echo 1001 > $dir/db/crlnumber
	;;
root)
	openssl req -new -config ${root_cnf} -out ${root_csr} -keyout ${root_key}
	openssl ca -selfsign -config ${root_cnf} -in ${root_csr} -out ${root_crt} -extensions ca_ext
	;;
sub)
	openssl req -new -config ${sub_cnf} -out ${sub_csr} -keyout ${sub_key}
	openssl ca -config ${root_cnf} -in ${sub_csr} -out ${sub_crt} -extensions sub_ca_ext
	;;
server)
	sdir="server-keys"
	mkdir $sdir 2>/dev/null
	# create rsa private key for Public Key Encryption
	openssl genrsa -out ${sdir}/server.key 2048
	openssl req -new -config ${server_cnf} -key ${sdir}/server.key -out ${sdir}/server.csr
	# issue server certificate 
	openssl ca -config ${sub_cnf} -in ${sdir}/server.csr -out ${sdir}/server.crt -extensions server_ext
	;;
*)
	usage
	exit 1;
	;;
esac
