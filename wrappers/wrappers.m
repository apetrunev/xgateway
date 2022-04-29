wrappers;
  QUIT

;	функции для работы с кодировкой
;
; $$XtoU^%iU6(data) -- из cp866 в utf8
; $$UtoX^%iU6(data) -- наоборот
; 

db() ;
 ;
 new name
 ;
 if $ZV["MSM-Workstation for Windows" s name="MSMWS" q name
 if $ZV["MSM-PC/PLUS" s name="MSMPC+" q name
 if $ZV["MSM-PC/386" s name="MSMPC3" q name
 if $ZV["MSM-PC" s name="MSMPC" q name
 if $ZV["MSM-UNIX" s name="MSMUNIX" q name
 if $ZV["DTM-PC"!($ZV["DT-MAX") s name="DTMPC" q name
 if $zv["MSM" s name="MSMUNIX" q name
 if $ZV["GT.M"!($ZV["GTM") s name="GTM" q name
 if $tr($zv,"cache","CACHE")["CACHE" s name="CACHE" q name
 s name="" q name

escapeq:(data) ; escape quotes
 ;
 new i,ndata
 ;
 if data[""""!(data["\")!(data?.e1c.e)!($d(data)) d
 . set ndata=""
 . for i=1:1:$l(data) d
 . . if ($e(data,i)="""")!($e(data,i)="\") set ndata=ndata_"\"_$e(data,i)
 . . else  if ($e(data,i)="\") set ndata=ndata_"\"_$e(data,i)
 . . else  set ndata=ndata_$e(data,i)
 else  set ndata=data
 ;
 q ndata

;
; Для каждой сессии(определяемой параметром key) создается глобаль где хранятся результаты работы функций
; wGetSP возвращает имя данной глобали
;

wGetSP:(key,err)
 ; 
 new glvn,dbname
 ;
 set err="",glvn="",dbname=""
 ;
 set dbname=$$db
 set glvn=$$GetSP^Z000o081(key,.err)
 ; 
 if err'=""  d
 ; для cache ковертируем в utf8
 . if db="CACHE" set err=$$XtoU^%iU6(err)
 ; сообщения могут содержать кавычки. необходимо их экранировать.
 . set err=escapeq(err)
 ; 
 q glvn

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Внешние функции (возвращают данные в формате json) ;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;
; wGet - get function for cache
;

wGet(glvn)
 ;
 new defined,ok,json,data,dbname
 ;
 set json="",data="",dbname=""
 ;
 set data=$get(@glvn)
 set dbname=$$db
 ;
 if dbname="CACHE" set data=$$XtoU^%iU6(data)
 ;
 set data=$$escapeq(data)
 ;
 set defined=$data(@glvn)#10
 set ok=1
 ;
 set json="{"
 set json=json_"""ok"":"_ok_","
 set json=json_"""global"":"_""""_glvn_""","
 set json=json_"""data"":"_""""_data_""","
 set json=json_"""defined"":"_defined_"}" 
 ;
 q json

;
; wGetSpJs возвращает глобаль в формате json
;

wGetSpJs(key)
 ;
 new glvn,json,err
 ;
 set glvn="",err="",json=""
 ;
 set glvn=$$wGetSP(key,.err)
 ;
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 . q json
 ; глобаль может содержать кавычки. экранируем.
 set glvn=$$escapeq(glvn)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""", "
 set json=json_"""glvn"":"_""""_glvn_""""
 set json=json_"}" 
 ;
 q json

;
; Формирование списка действий доступных пользователю на клиенте 
;

wGetAvailDoc(key)
 ;
 new err,json,dbname
 ; 
 set err="",json="",dbname=""
 ;
 set glvn=$$wGetSP(key,.err)
 ;
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 . q json
 ; результат работы функции находится в глобали `glvn`
 set err=$$GetSpOB^Z000o081(key,glvn)
 ;
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=escapeq(err)
 ;  
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ; 
 q json

;
; wScan2Dd заносит отсканированный штрихкод в систему
;
; key - ключ сессии (по нему определим номер пользователя)
; ob - объект документа, обрабатываемые документы:
; --XN - ТТН
; --XP - Накладная на перемещение
; --XO - ПО
; --XW - ведомость списания
; --XR - ведомость расхода
;
; ex - ид-р документа
; shk - строка считанного сканером штрих-кода
; nr - режим работы:
;
; --0 - добавление упаковки (или порции) в документ без проверок
; --1 - добавление упаковки (или порции) в документ с котролем считанного ШК (например по предельному списку)
; --2 - удаление упаковки (или порции) из документа
;
; sp - ссылка на глобаль, в которую поместить список материалов, указанных в документе, и остатки количеств этих материалов
;
; список имеет следующую структуру:
;
; @sp@(<ид-р материала>)=<код материала>"#"<остаток планового кол-ва>"#"<кол-во фактическое (включено в документ)>"#"<наименование материала>
;
; fms - признак того, что для каждой партии из упаковок нужно создавать свою операцию отгрузки
;       (параметр задается только при вставке упаковок в документ ТТН если режим работы (nr) равен 0 (вставка произвольных упаковок без контроля),
;       во всех остальных случаях этот параметр игнорируется
;
; <: "" - Ок (изменения внесены в БД)
;
; иначе - текст сообщения в кодировке CP866
; 
; example:
;   $$Scan2Db^wrappers("1","XN","162303","1005525083005809500096801002638100","1","^TESTIGOREK")
;

wScan2Db(key,ob,ex,shk,nr,fms)
 ;
 new sp,err,json,dbname
 ;
 set err="",json="",dbname="",sp=""
 ;
 set fms=$get(fms)
 set sp=$$wGetSP(key,.err)
 ;
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 . q json
 ;
 set err=$$ScanToDB^Z000o080(key,ob,ex,shk,nr,sp,fms)
 ;
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json
 
;
; авторизация пользователя
;
; pass1 -- пароль
; pass2 -- собственный пароль
;

wLogin(key,uid,pass1,pass2)
 ;
 new err,dbname
 ; 
 set err="",dbname=""
 ;
 set pass1=$get(pass1)
 set pass2=$get(pass2)
 ; 
 if pass2="" set err=$$Login^Z000o081(key,uid,pass1)
 else  set err=$$Login^Z000o081(key,uid,pass1,pass2)
 ;
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json

wLogOff(key)
 ;
 new err,json,dbname
 ;
 set err="",json="",dbname=""
 ;
 set err=$$LogOff^Z000o081(key)
 ;
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json
 
;
; Проверка доступности документа и формирования его состава
;
; doctype -- тип документа 
; idsample -- идентификатор экземпляра документа
; glvn -- временная глобаль
;

wGetDoc(key,doctype,docid)
 ;
 new err,glvn,json,dbname
 ; 
 set err="",glvn="",json="",dbname=""
 ;
 set glvn=$$wGetSP(key,.err)
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 ;
 set err=$$GetDoc^Z000o081(key,doctype,docid,glvn)
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json

;
; context -- "id_материала#id_владельца#признакэксплуатации"
;

wGetMaterialStorage(key,context,doctype,docid)
 ;
 new err,glvn,dbname
 ; 
 set err="",glvn="",dbname=""
 ;
 set glvn=$$wGetSP(key,.err)
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 . q json
 ;
 set err=$$OtHrM^Z000o083(key,context,glvn,doctype,docid)
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ; 
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json

;
; Формирование состава упаковки
; shk -- штрихкод
;

wSpecVd(key,shk)
 ;
 new err,glvn,json,dbname
 ;
 set err="",glvn="",json="",dbname=""
 ;
 set glvn=$$wGetSP(key,.err)
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 . q json
 ;
 set err=$$SpecVD^Z000o083(key,shk,glvn)
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json

;
; Функция формирования подробной информации по штрих-коду
; 

wDecodeShk(key,shk)
 ;
 new glvn,err,json,dbname
 ;
 set err="",glvn="",json="",dbname=""
 ;
 set glvn=$$wGetSP(key,.err)
 if err'=""  d
 . set json="{"
 . set json=json_"""errmsg"":"_""""_err_""""
 . set json=json_"}"
 . q json
 ;
 set err=$$DecodShk^Z000o084(key,shk,glvn)
 ;
 if err'=""  d
 . set dbname=$$db
 . if dbname="CACHE" set err=$$XtoU^%iU6(err)
 . set err=$$escapeq(err)
 ;
 set json="{"
 set json=json_"""errmsg"":"_""""_err_""""
 set json=json_"}"
 ;
 q json
