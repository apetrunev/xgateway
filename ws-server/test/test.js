vr arr = [];
arr.push("MOL");
arr.push("batch");
arr.push("portion");

re_all=/(MOL|batch|portion){1}/;
re_mb=/((MOL|batch)[,]?){2}/;
re_mp=/((MOL|portion)[,]?){2}/;
re_bp=/((batch|portion)[,]?){2}/;
re_simgle=/((MOL|batch|portion)[,]?){3}/;

// str = arr.join(',');

str = "batch,portion";

switch (str.length > 0) {
case /((MOL|batch|portion)[,]?){3}/.test(str):
	console.log(str);
	break;
case /((MOL|batch)[,]?){2}/.test(str):
	console.log(str);
	break;
case /((MOL|portion)[,]?){2}/.test(str):
	console.log(str);
	break;
case /((batch|portion)[,]?){2}/.test(str):
	console.log("bp " + str);
	break;
case /(MOL|batch|portion){1}/.test(str):
	switch (true) {
	case /MOL/.test(str):
	case /batch/.test(str):
	case /portion/.test(str):
		console.log(str);
		break;
	}
	break;
default:
	break;
}
