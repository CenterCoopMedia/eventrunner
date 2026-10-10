import{aE as re,aF as je,aG as De,aH as Le,aI as Fe,aJ as Me,aK as Te,aL as $e,aM as Ve,aN as He,aO as ze,aP as de,aQ as Xe,C as Re,aR as J,aS as ne,aT as Ye,r as v,aC as Ge,j as l,A as We,B as qe,z as Ke,c as Je,b as Ze,ab as Qe,l as et,aU as F,V as he,L as tt,W as pe,aV as nt,a1 as M,a7 as fe}from"./index-CEdLz4MP.js";import{P as st,D as rt}from"./DefaultAvatarPicker-DEIRjr7M.js";import{R as it,C as ot}from"./Choice-DiILUFPj.js";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const we="firebasestorage.googleapis.com",Ne="storageBucket",at=2*60*1e3,lt=10*60*1e3;/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class b extends Me{constructor(t,n,s=0){super(Q(t),`Firebase Storage: ${n} (${Q(t)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,b.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return Q(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var _;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(_||(_={}));function Q(e){return"storage/"+e}function ie(){const e="An unknown error occurred, please check the error payload for server response.";return new b(_.UNKNOWN,e)}function ct(e){return new b(_.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function ut(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new b(_.UNAUTHENTICATED,e)}function dt(){return new b(_.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function ht(e){return new b(_.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function pt(){return new b(_.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function ft(){return new b(_.CANCELED,"User canceled the upload/download.")}function mt(e){return new b(_.INVALID_URL,"Invalid URL '"+e+"'.")}function gt(e){return new b(_.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function _t(){return new b(_.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+Ne+"' property when initializing the app?")}function bt(){return new b(_.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function yt(e){return new b(_.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function se(e){return new b(_.INVALID_ARGUMENT,e)}function ke(){return new b(_.APP_DELETED,"The Firebase app was deleted.")}function xt(e){return new b(_.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function Y(e,t){return new b(_.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function X(e){throw new b(_.INTERNAL_ERROR,"Internal error: "+e)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class C{constructor(t,n){this.bucket=t,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,n){let s;try{s=C.makeFromUrl(t,n)}catch{return new C(t,"")}if(s.path==="")return s;throw gt(t)}static makeFromUrl(t,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function i(g){g.path.charAt(g.path.length-1)==="/"&&(g.path_=g.path_.slice(0,-1))}const a="(/(.*))?$",u=new RegExp("^gs://"+r+a,"i"),o={bucket:1,path:3};function h(g){g.path_=decodeURIComponent(g.path)}const f="v[A-Za-z0-9_]+",T=n.replace(/[.]/g,"\\."),N="(/([^?#]*).*)?$",O=new RegExp(`^https?://${T}/${f}/b/${r}/o${N}`,"i"),k={bucket:1,path:3},A=n===we?"(?:storage.googleapis.com|storage.cloud.google.com)":n,p="([^?#]*)",R=new RegExp(`^https?://${A}/${r}/${p}`,"i"),w=[{regex:u,indices:o,postModify:i},{regex:O,indices:k,postModify:h},{regex:R,indices:{bucket:1,path:2},postModify:h}];for(let g=0;g<w.length;g++){const B=w[g],$=B.regex.exec(t);if($){const V=$[B.indices.bucket];let H=$[B.indices.path];H||(H=""),s=new C(V,H),B.postModify(s);break}}if(s==null)throw mt(t);return s}}class Tt{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Rt(e,t,n){let s=1,r=null,i=null,a=!1,u=0;function o(){return u===2}let h=!1;function f(...p){h||(h=!0,t.apply(null,p))}function T(p){r=setTimeout(()=>{r=null,e(O,o())},p)}function N(){i&&clearTimeout(i)}function O(p,...R){if(h){N();return}if(p){N(),f.call(null,p,...R);return}if(o()||a){N(),f.call(null,p,...R);return}s<64&&(s*=2);let w;u===1?(u=2,w=0):w=(s+Math.random())*1e3,T(w)}let k=!1;function A(p){k||(k=!0,N(),!h&&(r!==null?(p||(u=2),clearTimeout(r),T(0)):p||(u=1)))}return T(0),i=setTimeout(()=>{a=!0,A(!0)},n),A}function wt(e){e(!1)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Nt(e){return e!==void 0}function kt(e){return typeof e=="object"&&!Array.isArray(e)}function Ae(e){return typeof e=="string"||e instanceof String}function me(e){return oe()&&e instanceof Blob}function oe(){return typeof Blob<"u"}function ge(e,t,n,s){if(s<t)throw se(`Invalid value for '${e}'. Expected ${t} or greater.`);if(s>n)throw se(`Invalid value for '${e}'. Expected ${n} or less.`)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function At(e,t,n){let s=t;return n==null&&(s=`https://${t}`),`${n}://${s}/v0${e}`}function Et(e){const t=encodeURIComponent;let n="?";for(const s in e)if(e.hasOwnProperty(s)){const r=t(s)+"="+t(e[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var j;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})(j||(j={}));/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function vt(e,t){const n=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,i=t.indexOf(e)!==-1;return n||r||i}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Pt{constructor(t,n,s,r,i,a,u,o,h,f,T,N=!0,O=!1){this.url_=t,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=i,this.additionalRetryCodes_=a,this.callback_=u,this.errorCallback_=o,this.timeout_=h,this.progressCallback_=f,this.connectionFactory_=T,this.retry=N,this.isUsingEmulator=O,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((k,A)=>{this.resolve_=k,this.reject_=A,this.start_()})}start_(){const t=(s,r)=>{if(r){s(!1,new q(!1,null,!0));return}const i=this.connectionFactory_();this.pendingConnection_=i;const a=u=>{const o=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(o,h)};this.progressCallback_!==null&&i.addUploadProgressListener(a),i.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&i.removeUploadProgressListener(a),this.pendingConnection_=null;const u=i.getErrorCode()===j.NO_ERROR,o=i.getStatus();if(!u||vt(o,this.additionalRetryCodes_)&&this.retry){const f=i.getErrorCode()===j.ABORT;s(!1,new q(!1,null,f));return}const h=this.successCodes_.indexOf(o)!==-1;s(!0,new q(h,i))})},n=(s,r)=>{const i=this.resolve_,a=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const o=this.callback_(u,u.getResponse());Nt(o)?i(o):i()}catch(o){a(o)}else if(u!==null){const o=ie();o.serverResponse=u.getErrorText(),this.errorCallback_?a(this.errorCallback_(u,o)):a(o)}else if(r.canceled){const o=this.appDelete_?ke():ft();a(o)}else{const o=pt();a(o)}};this.canceled_?n(!1,new q(!1,null,!0)):this.backoffId_=Rt(t,n,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&wt(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class q{constructor(t,n,s){this.wasSuccessCode=t,this.connection=n,this.canceled=!!s}}function Ct(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function Ot(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function It(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Bt(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function Ut(e,t,n,s,r,i,a=!0,u=!1){const o=Et(e.urlParams),h=e.url+o,f=Object.assign({},e.headers);return It(f,t),Ct(f,n),Ot(f,i),Bt(f,s),new Pt(h,e.method,f,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,a,u)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function St(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function jt(...e){const t=St();if(t!==void 0){const n=new t;for(let s=0;s<e.length;s++)n.append(e[s]);return n.getBlob()}else{if(oe())return new Blob(e);throw new b(_.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Dt(e,t,n){return e.webkitSlice?e.webkitSlice(t,n):e.mozSlice?e.mozSlice(t,n):e.slice?e.slice(t,n):null}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Lt(e){if(typeof atob>"u")throw yt("base-64");return atob(e)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const I={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class ee{constructor(t,n){this.data=t,this.contentType=n||null}}function Ft(e,t){switch(e){case I.RAW:return new ee(Ee(t));case I.BASE64:case I.BASE64URL:return new ee(ve(e,t));case I.DATA_URL:return new ee($t(t),Vt(t))}throw ie()}function Ee(e){const t=[];for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);if(s<=127)t.push(s);else if(s<=2047)t.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<e.length-1&&(e.charCodeAt(n+1)&64512)===56320))t.push(239,191,189);else{const i=s,a=e.charCodeAt(++n);s=65536|(i&1023)<<10|a&1023,t.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?t.push(239,191,189):t.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(t)}function Mt(e){let t;try{t=decodeURIComponent(e)}catch{throw Y(I.DATA_URL,"Malformed data URL.")}return Ee(t)}function ve(e,t){switch(e){case I.BASE64:{const r=t.indexOf("-")!==-1,i=t.indexOf("_")!==-1;if(r||i)throw Y(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case I.BASE64URL:{const r=t.indexOf("+")!==-1,i=t.indexOf("/")!==-1;if(r||i)throw Y(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=Lt(t)}catch(r){throw r.message.includes("polyfill")?r:Y(e,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class Pe{constructor(t){this.base64=!1,this.contentType=null;const n=t.match(/^data:([^,]+)?,/);if(n===null)throw Y(I.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=Ht(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=t.substring(t.indexOf(",")+1)}}function $t(e){const t=new Pe(e);return t.base64?ve(I.BASE64,t.rest):Mt(t.rest)}function Vt(e){return new Pe(e).contentType}function Ht(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class U{constructor(t,n){let s=0,r="";me(t)?(this.data_=t,s=t.size,r=t.type):t instanceof ArrayBuffer?(n?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),s=this.data_.length):t instanceof Uint8Array&&(n?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),s=t.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,n){if(me(this.data_)){const s=this.data_,r=Dt(s,t,n);return r===null?null:new U(r)}else{const s=new Uint8Array(this.data_.buffer,t,n-t);return new U(s,!0)}}static getBlob(...t){if(oe()){const n=t.map(s=>s instanceof U?s.data_:s);return new U(jt.apply(null,n))}else{const n=t.map(a=>Ae(a)?Ft(I.RAW,a).data:a.data_);let s=0;n.forEach(a=>{s+=a.byteLength});const r=new Uint8Array(s);let i=0;return n.forEach(a=>{for(let u=0;u<a.length;u++)r[i++]=a[u]}),new U(r,!0)}}uploadData(){return this.data_}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function zt(e){let t;try{t=JSON.parse(e)}catch{return null}return kt(t)?t:null}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Xt(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function Yt(e,t){const n=t.split("/").filter(s=>s.length>0).join("/");return e.length===0?n:e+"/"+n}function Ce(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Gt(e,t){return t}class E{constructor(t,n,s,r){this.server=t,this.local=n||t,this.writable=!!s,this.xform=r||Gt}}let K=null;function Wt(e){return!Ae(e)||e.length<2?e:Ce(e)}function qt(){if(K)return K;const e=[];e.push(new E("bucket")),e.push(new E("generation")),e.push(new E("metageneration")),e.push(new E("name","fullPath",!0));function t(i,a){return Wt(a)}const n=new E("name");n.xform=t,e.push(n);function s(i,a){return a!==void 0?Number(a):a}const r=new E("size");return r.xform=s,e.push(r),e.push(new E("timeCreated")),e.push(new E("updated")),e.push(new E("md5Hash",null,!0)),e.push(new E("cacheControl",null,!0)),e.push(new E("contentDisposition",null,!0)),e.push(new E("contentEncoding",null,!0)),e.push(new E("contentLanguage",null,!0)),e.push(new E("contentType",null,!0)),e.push(new E("metadata","customMetadata",!0)),K=e,K}function Kt(e,t){function n(){const s=e.bucket,r=e.fullPath,i=new C(s,r);return t._makeStorageReference(i)}Object.defineProperty(e,"ref",{get:n})}function Jt(e,t,n){const s={};s.type="file";const r=n.length;for(let i=0;i<r;i++){const a=n[i];s[a.local]=a.xform(s,t[a.server])}return Kt(s,e),s}function Zt(e,t,n){const s=zt(t);return s===null?null:Jt(e,s,n)}function Qt(e,t){const n={},s=t.length;for(let r=0;r<s;r++){const i=t[r];i.writable&&(n[i.server]=e[i.local])}return JSON.stringify(n)}class en{constructor(t,n,s,r){this.url=t,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function tn(e){if(!e)throw ie()}function nn(e,t){function n(s,r){const i=Zt(e,r,t);return tn(i!==null),i}return n}function sn(e){function t(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=dt():r=ut():n.getStatus()===402?r=ct(e.bucket):n.getStatus()===403?r=ht(e.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return t}function rn(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function on(e,t,n){const s=Object.assign({},n);return s.fullPath=e.path,s.size=t.size(),s.contentType||(s.contentType=rn(null,t)),s}function an(e,t,n,s,r){const i=t.bucketOnlyServerUrl(),a={"X-Goog-Upload-Protocol":"multipart"};function u(){let w="";for(let g=0;g<2;g++)w=w+Math.random().toString().slice(2);return w}const o=u();a["Content-Type"]="multipart/related; boundary="+o;const h=on(t,s,r),f=Qt(h,n),T="--"+o+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+f+`\r
--`+o+`\r
Content-Type: `+h.contentType+`\r
\r
`,N=`\r
--`+o+"--",O=U.getBlob(T,s,N);if(O===null)throw bt();const k={name:h.fullPath},A=At(i,e.host,e._protocol),p="POST",R=e.maxUploadRetryTime,P=new en(A,p,nn(e,n),R);return P.urlParams=k,P.headers=a,P.body=O.uploadData(),P.errorHandler=sn(t),P}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ln{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=j.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=j.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=j.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,n,s,r,i){if(this.sent_)throw X("cannot .send() more than once");if(Te(t)&&s&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(n,t,!0),i!==void 0)for(const a in i)i.hasOwnProperty(a)&&this.xhr_.setRequestHeader(a,i[a].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw X("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw X("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw X("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw X("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class cn extends ln{initXhr(){this.xhr_.responseType="text"}}function un(){return new cn}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class D{constructor(t,n){this._service=t,n instanceof C?this._location=n:this._location=C.makeFromUrl(n,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,n){return new D(t,n)}get root(){const t=new C(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return Ce(this._location.path)}get storage(){return this._service}get parent(){const t=Xt(this._location.path);if(t===null)return null;const n=new C(this._location.bucket,t);return new D(this._service,n)}_throwIfRoot(t){if(this._location.path==="")throw xt(t)}}function dn(e,t,n){e._throwIfRoot("uploadBytes");const s=an(e.storage,e._location,qt(),new U(t,!0),n);return e.storage.makeRequestWithTokens(s,un).then(r=>({metadata:r,ref:e}))}function hn(e,t){const n=Yt(e._location.path,t),s=new C(e._location.bucket,n);return new D(e.storage,s)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function pn(e){return/^[A-Za-z]+:\/\//.test(e)}function fn(e,t){return new D(e,t)}function Oe(e,t){if(e instanceof ae){const n=e;if(n._bucket==null)throw _t();const s=new D(n,n._bucket);return t!=null?Oe(s,t):s}else return t!==void 0?hn(e,t):e}function mn(e,t){if(t&&pn(t)){if(e instanceof ae)return fn(e,t);throw se("To use ref(service, url), the first argument must be a Storage instance.")}else return Oe(e,t)}function _e(e,t){const n=t==null?void 0:t[Ne];return n==null?null:C.makeFromBucketSpec(n,e)}function gn(e,t,n,s={}){e.host=`${t}:${n}`;const r=Te(t);r&&$e(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:i}=s;i&&(e._overrideAuthToken=typeof i=="string"?i:Ve(i,e.app.options.projectId))}class ae{constructor(t,n,s,r,i,a=!1){this.app=t,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=i,this._isUsingEmulator=a,this._bucket=null,this._host=we,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=at,this._maxUploadRetryTime=lt,this._requests=new Set,r!=null?this._bucket=C.makeFromBucketSpec(r,this._host):this._bucket=_e(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=C.makeFromBucketSpec(this._url,t):this._bucket=_e(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){ge("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){ge("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const n=await t.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){if(Fe(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new D(this,t)}_makeRequest(t,n,s,r,i=!0){if(this._deleted)return new Tt(ke());{const a=Ut(t,this._appId,s,r,n,this._firebaseVersion,i,this._isUsingEmulator);return this._requests.add(a),a.getPromise().then(()=>this._requests.delete(a),()=>this._requests.delete(a)),a}}async makeRequestWithTokens(t,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,n,s,r).getPromise()}}const be="@firebase/storage",ye="0.14.4";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ie="storage";function _n(e,t,n){return e=re(e),dn(e,t,n)}function bn(e,t){return e=re(e),mn(e,t)}function yn(e=Le(),t){e=re(e);const s=je(e,Ie).getImmediate({identifier:t}),r=De("storage");return r&&xn(s,...r),s}function xn(e,t,n,s={}){gn(e,t,n,s)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Tn(e,{instanceIdentifier:t}){const n=e.getProvider("app").getImmediate(),s=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new ae(n,s,r,t,Xe)}function Rn(){He(new ze(Ie,Tn,"PUBLIC").setMultipleInstances(!0)),de(be,ye,""),de(be,ye,"esm2020")}Rn();let te=null;function wn(){const e=globalThis.crypto;return e&&typeof e.randomUUID=="function"?e.randomUUID():`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}function Nn(){return te||(te=yn(Ye)),te}async function kn({uid:e,file:t}){const n=Re(t,{types:J,maxBytes:ne,exclusive:!0});if(n)throw new Error(n);const s=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=wn(),i=`profile-photos/${e}/${r}/photo.${s}`;return await _n(bn(Nn(),i),t,{contentType:t.type}),{path:i}}function An({uid:e,value:t,onChange:n,onPendingChange:s}){const r=v.useRef(null),[i,a]=v.useState(null),[u,o]=v.useState(!1),[h,f]=v.useState(null);function T(p){s==null||s(p)}async function N(p){o(!0),T(!0),a(null);try{const{path:R}=await kn({uid:e,file:p});n(R)}catch{a("Your photo could not be uploaded. Try again.")}finally{o(!1),f(null),T(!1),r.current&&(r.current.value="")}}async function O(p){var w;const R=((w=p.target.files)==null?void 0:w[0])??null;if(!R)return;const P=Re(R,{types:J,maxBytes:ne,exclusive:!0});if(P){a(P),r.current&&(r.current.value="");return}r.current&&(r.current.value=""),f(R),T(!0)}function k(){n("")}const A=Ge(t);return l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("span",{className:"block font-semibold text-text-primary",children:"Photo"}),l.jsxs("div",{className:"flex items-center gap-4",children:[t&&!A?l.jsx(We,{path:t,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):A?l.jsx("img",{src:A,alt:"Your chosen default avatar",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):l.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-text-primary/20 text-xs text-text-secondary",children:"None"}),l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("label",{htmlFor:"profile-photo",className:"file-input-label touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-text-primary/20 bg-surface px-4 py-2 font-semibold text-text-primary hover:bg-surface-alt",children:u?"Uploading…":t?"Replace photo":"Upload a photo"}),l.jsx("input",{id:"profile-photo",ref:r,type:"file",accept:J.join(","),className:"sr-only",disabled:u,onChange:O,"aria-describedby":"profile-photo-hint"}),t?l.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-text-secondary underline hover:bg-surface-alt",onClick:k,disabled:u,children:"Remove photo"}):null]})]}),h?l.jsx(st,{file:h,label:"your profile photo",onApply:p=>N(p),onCancel:()=>{f(null),T(!1)}}):null,l.jsx(rt,{value:t,onChange:n,namePrefix:"profile"}),l.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-text-secondary",children:[J.map(qe).join(", ")," · up to"," ",Ke(ne),". Save your profile to publish the change."]}),i?l.jsx("p",{role:"alert",className:"text-sm text-danger",children:i}):null]})}const xe={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function En(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id,maxPicks:Number.isInteger(n.maxPicks)&&n.maxPicks>0?n.maxPicks:null,badges:(Array.isArray(n.badges)?n.badges:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id}))})).filter(n=>n.badges.length>0)}const vn=5;function Pn(e){return e.reduce((t,n)=>t+Math.min(n.maxPicks??n.badges.length,n.badges.length),0)}function Bn(){const{user:e}=Je(),{features:t,badges:n}=Ze(),{profile:s,status:r,needsProfileSetup:i,saveProfile:a}=Qe(),{showToast:u}=et(),[o,h]=v.useState(null),[f,T]=v.useState(!1),[N,O]=v.useState(!1),[k,A]=v.useState(null),[p,R]=v.useState(null),P=v.useRef(null),w=v.useRef([]),g=v.useRef([]),B=v.useRef([]);if(v.useEffect(()=>{o!=null||s==null||(g.current=Array.isArray(s.customBadges)?s.customBadges:[],B.current=g.current,h({displayName:s.displayName??"",pronouns:s.pronouns??"",jobTitle:s.jobTitle??"",organization:s.organization??"",bio:s.bio??"",profileVisibility:s.profileVisibility??"attendees_only",badges:Array.isArray(s.badges)?s.badges:[],customBadges:Array.from({length:F.MAX_CUSTOM_BADGES},(c,d)=>{var m;return typeof((m=s.customBadges)==null?void 0:m[d])=="string"?s.customBadges[d]:""}),photoPath:typeof s.photoPath=="string"?s.photoPath:""}))},[s,o]),v.useEffect(()=>{if(!s)return;const c=x=>typeof x=="string"?x.trim().replace(/\s+/g," ").toLowerCase():"",d=Array.isArray(s.customBadges)?s.customBadges:[],m=new Set(d.map(c)),y=new Set(B.current.map(c).filter(x=>!m.has(x)));B.current=d,y.size&&(g.current=g.current.filter(x=>!y.has(c(x))),h(x=>x&&{...x,customBadges:x.customBadges.map(z=>y.has(c(z))?"":z)}))},[s]),!e)return l.jsx(he,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:l.jsx(tt,{to:"/signin",className:pe,children:"Go to sign in"})});if(r==="pending-account"||o==null)return l.jsx(he,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const $=nt.PROFILE_VISIBILITIES.filter(c=>c!=="public"||t.publicAttendeeProfiles||o.profileVisibility==="public"),V=t.badges?En(n):[],H=F.MAX_TOTAL_BADGES-Pn(V)<=vn,S=(c,d)=>h(m=>({...m,[c]:d})),Be=c=>h(d=>({...d,badges:d.badges.includes(c)?d.badges.filter(m=>m!==c):[...d.badges,c]})),Ue=(c,d)=>{h(m=>({...m,customBadges:m.customBadges.map((y,x)=>x===c?d:y)})),R(null)},Se=async c=>{var le,ce;if(c.preventDefault(),N||f)return;if(o.displayName.trim().length===0){A("Enter the name you want other attendees to see."),(le=P.current)==null||le.focus();return}A(null);let d;const m=G=>G.filter(L=>typeof L=="string"&&L.trim().length>0),y=m(o.customBadges),x=m(g.current),z=JSON.stringify(y)!==JSON.stringify(x);if(t.customBadges===!0){const G=F.validateCustomBadges(y,{blockList:n==null?void 0:n.customBadgeBlockList});if(G.rejected.length>0){let L=0,Z=[];for(let W=0;W<o.customBadges.length;W+=1){const ue=o.customBadges[W];if(ue.trim()&&(Z=[...Z,ue],F.validateCustomBadges(Z,{blockList:n==null?void 0:n.customBadgeBlockList}).rejected.length>0)){L=W;break}}R({index:L,message:"Choose another custom badge. Use 24 characters or fewer, use only letters, numbers, spaces, apostrophes, hyphens, or periods, and do not use a blocked or repeated badge."}),(ce=w.current[L])==null||ce.focus();return}d=G.valid}R(null),T(!0);try{await a({displayName:o.displayName.trim(),pronouns:o.pronouns.trim(),jobTitle:o.jobTitle.trim(),organization:o.organization.trim(),bio:o.bio.trim(),profileVisibility:o.profileVisibility,badges:o.badges,...t.customBadges===!0&&z?{customBadges:d}:{},photoPath:o.photoPath?o.photoPath:null}),t.customBadges===!0&&z&&(g.current=d),u("Profile saved.")}catch{u("Your profile could not be saved. Try again.",{tone:"error"})}finally{T(!1)}};return l.jsxs("article",{className:"mx-auto max-w-2xl",children:[l.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:i?"Complete your profile":"Your profile"}),l.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),l.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:Se,noValidate:!0,children:[l.jsx(An,{uid:e.uid,value:o.photoPath,onChange:c=>S("photoPath",c),onPendingChange:O}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),l.jsx("input",{id:"displayName",ref:P,className:`mt-2xs ${M}`,value:o.displayName,onChange:c=>S("displayName",c.target.value),"aria-invalid":k?"true":void 0,"aria-describedby":k?"displayName-error":void 0,autoComplete:"name"}),k?l.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:k}):null]}),l.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[l.jsxs("div",{children:[l.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),l.jsx("input",{id:"pronouns",className:`mt-2xs ${M}`,value:o.pronouns,onChange:c=>S("pronouns",c.target.value)})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),l.jsx("input",{id:"jobTitle",className:`mt-2xs ${M}`,value:o.jobTitle,onChange:c=>S("jobTitle",c.target.value),autoComplete:"organization-title"})]})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),l.jsx("input",{id:"organization",className:`mt-2xs ${M}`,value:o.organization,onChange:c=>S("organization",c.target.value),autoComplete:"organization"})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),l.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${M}`,value:o.bio,onChange:c=>S("bio",c.target.value)})]}),l.jsxs("fieldset",{children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),l.jsx("div",{className:"mt-xs space-y-xs",children:$.map(c=>l.jsx(it,{name:"profileVisibility",value:c,label:xe[c].label,description:xe[c].description,checked:o.profileVisibility===c,onChange:()=>S("profileVisibility",c)},c))})]}),V.length>0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(fe,{level:2,title:"Badges"}),H?l.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",F.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,V.map(c=>{const d=c.badges.filter(y=>o.badges.includes(y.id)).length,m=c.maxPicks!=null&&d>=c.maxPicks;return l.jsxs("fieldset",{className:"mt-md",children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:c.label}),c.maxPicks!=null?l.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:m?`You’ve picked all ${c.maxPicks} — clear one to choose another.`:`Pick up to ${c.maxPicks} (${d} chosen).`}):null,l.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:c.badges.map(y=>{const x=o.badges.includes(y.id);return l.jsx(ot,{label:y.label,checked:x,disabled:!x&&m,className:!x&&m?"text-text-secondary":"",onChange:()=>Be(y.id)},y.id)})})]},c.id)})]}):null,t.customBadges===!0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(fe,{level:2,title:"Custom badges"}),l.jsx("div",{className:"mt-md grid gap-md sm:grid-cols-3",children:o.customBadges.map((c,d)=>{const m=(p==null?void 0:p.index)===d?p.message:null;return l.jsxs("div",{children:[l.jsxs("label",{htmlFor:`customBadge-${d}`,className:"block font-semibold text-text-primary",children:["Custom badge ",d+1]}),l.jsx("input",{id:`customBadge-${d}`,ref:y=>{w.current[d]=y},className:`mt-2xs ${M}`,value:c,maxLength:F.MAX_CUSTOM_BADGE_LENGTH,onChange:y=>Ue(d,y.target.value),"aria-invalid":m?"true":void 0,"aria-describedby":m?`customBadge-${d}-error`:void 0}),m?l.jsx("p",{id:`customBadge-${d}-error`,role:"alert",className:"mt-2xs font-data text-caption text-danger",children:m}):null]},d)})})]}):null,l.jsx("button",{type:"submit",className:pe,disabled:f||N,children:f?"Saving…":"Save profile"})]})]})}export{Bn as default};
