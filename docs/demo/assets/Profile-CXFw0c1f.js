import{aF as ee,aG as Ye,aH as Xe,aI as qe,aJ as We,aK as Ge,aL as ke,aM as Ke,aN as Je,aO as Ze,aP as Qe,aQ as fe,aR as et,F as Ne,aS as Q,aT as oe,aU as tt,r as g,aD as nt,j as l,B as st,E as rt,C as ot,c as it,b as at,ad as lt,n as ct,aV as z,X as me,L as ut,Y as ge,aW as dt,a3 as Y,a9 as _e}from"./index-C1xAQhkx.js";import{P as ht,D as pt}from"./DefaultAvatarPicker-D0Jt38Ra.js";import{R as ft,C as mt}from"./Choice-BIF_jf0s.js";/**
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
 */const Ae="firebasestorage.googleapis.com",Ee="storageBucket",gt=2*60*1e3,_t=10*60*1e3;/**
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
 */class b extends Ge{constructor(t,n,s=0){super(ne(t),`Firebase Storage: ${n} (${ne(t)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,b.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return ne(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var _;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(_||(_={}));function ne(e){return"storage/"+e}function ae(){const e="An unknown error occurred, please check the error payload for server response.";return new b(_.UNKNOWN,e)}function bt(e){return new b(_.OBJECT_NOT_FOUND,"Object '"+e+"' does not exist.")}function yt(e){return new b(_.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function xt(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new b(_.UNAUTHENTICATED,e)}function Rt(){return new b(_.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function wt(e){return new b(_.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function Tt(){return new b(_.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function kt(){return new b(_.CANCELED,"User canceled the upload/download.")}function Nt(e){return new b(_.INVALID_URL,"Invalid URL '"+e+"'.")}function At(e){return new b(_.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function Et(){return new b(_.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+Ee+"' property when initializing the app?")}function vt(){return new b(_.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function Ot(e){return new b(_.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function ie(e){return new b(_.INVALID_ARGUMENT,e)}function ve(){return new b(_.APP_DELETED,"The Firebase app was deleted.")}function Pt(e){return new b(_.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function G(e,t){return new b(_.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function W(e){throw new b(_.INTERNAL_ERROR,"Internal error: "+e)}/**
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
 */class B{constructor(t,n){this.bucket=t,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,n){let s;try{s=B.makeFromUrl(t,n)}catch{return new B(t,"")}if(s.path==="")return s;throw At(t)}static makeFromUrl(t,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function o(x){x.path.charAt(x.path.length-1)==="/"&&(x.path_=x.path_.slice(0,-1))}const i="(/(.*))?$",u=new RegExp("^gs://"+r+i,"i"),a={bucket:1,path:3};function h(x){x.path_=decodeURIComponent(x.path)}const p="v[A-Za-z0-9_]+",E=n.replace(/[.]/g,"\\."),k="(/([^?#]*).*)?$",N=new RegExp(`^https?://${E}/${p}/b/${r}/o${k}`,"i"),A={bucket:1,path:3},m=n===Ae?"(?:storage.googleapis.com|storage.cloud.google.com)":n,y="([^?#]*)",v=new RegExp(`^https?://${m}/${r}/${y}`,"i"),O=[{regex:u,indices:a,postModify:o},{regex:N,indices:A,postModify:h},{regex:v,indices:{bucket:1,path:2},postModify:h}];for(let x=0;x<O.length;x++){const I=O[x],S=I.regex.exec(t);if(S){const R=S[I.indices.bucket];let j=S[I.indices.path];j||(j=""),s=new B(R,j),I.postModify(s);break}}if(s==null)throw Nt(t);return s}}class Ut{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
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
 */function It(e,t,n){let s=1,r=null,o=null,i=!1,u=0;function a(){return u===2}let h=!1;function p(...y){h||(h=!0,t.apply(null,y))}function E(y){r=setTimeout(()=>{r=null,e(N,a())},y)}function k(){o&&clearTimeout(o)}function N(y,...v){if(h){k();return}if(y){k(),p.call(null,y,...v);return}if(a()||i){k(),p.call(null,y,...v);return}s<64&&(s*=2);let O;u===1?(u=2,O=0):O=(s+Math.random())*1e3,E(O)}let A=!1;function m(y){A||(A=!0,k(),!h&&(r!==null?(y||(u=2),clearTimeout(r),E(0)):y||(u=1)))}return E(0),o=setTimeout(()=>{i=!0,m(!0)},n),m}function jt(e){e(!1)}/**
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
 */function Bt(e){return e!==void 0}function St(e){return typeof e=="object"&&!Array.isArray(e)}function Oe(e){return typeof e=="string"||e instanceof String}function be(e){return le()&&e instanceof Blob}function le(){return typeof Blob<"u"}function ye(e,t,n,s){if(s<t)throw ie(`Invalid value for '${e}'. Expected ${t} or greater.`);if(s>n)throw ie(`Invalid value for '${e}'. Expected ${n} or less.`)}/**
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
 */function Pe(e,t,n){let s=t;return n==null&&(s=`https://${t}`),`${n}://${s}/v0${e}`}function Ct(e){const t=encodeURIComponent;let n="?";for(const s in e)if(e.hasOwnProperty(s)){const r=t(s)+"="+t(e[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var $;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})($||($={}));/**
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
 */function Lt(e,t){const n=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,o=t.indexOf(e)!==-1;return n||r||o}/**
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
 */class Dt{constructor(t,n,s,r,o,i,u,a,h,p,E,k=!0,N=!1){this.url_=t,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=o,this.additionalRetryCodes_=i,this.callback_=u,this.errorCallback_=a,this.timeout_=h,this.progressCallback_=p,this.connectionFactory_=E,this.retry=k,this.isUsingEmulator=N,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((A,m)=>{this.resolve_=A,this.reject_=m,this.start_()})}start_(){const t=(s,r)=>{if(r){s(!1,new J(!1,null,!0));return}const o=this.connectionFactory_();this.pendingConnection_=o;const i=u=>{const a=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(a,h)};this.progressCallback_!==null&&o.addUploadProgressListener(i),o.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&o.removeUploadProgressListener(i),this.pendingConnection_=null;const u=o.getErrorCode()===$.NO_ERROR,a=o.getStatus();if(!u||Lt(a,this.additionalRetryCodes_)&&this.retry){const p=o.getErrorCode()===$.ABORT;s(!1,new J(!1,null,p));return}const h=this.successCodes_.indexOf(a)!==-1;s(!0,new J(h,o))})},n=(s,r)=>{const o=this.resolve_,i=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const a=this.callback_(u,u.getResponse());Bt(a)?o(a):o()}catch(a){i(a)}else if(u!==null){const a=ae();a.serverResponse=u.getErrorText(),this.errorCallback_?i(this.errorCallback_(u,a)):i(a)}else if(r.canceled){const a=this.appDelete_?ve():kt();i(a)}else{const a=Tt();i(a)}};this.canceled_?n(!1,new J(!1,null,!0)):this.backoffId_=It(t,n,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&jt(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class J{constructor(t,n,s){this.wasSuccessCode=t,this.connection=n,this.canceled=!!s}}function Ft(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function Mt(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function $t(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Ht(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function Vt(e,t,n,s,r,o,i=!0,u=!1){const a=Ct(e.urlParams),h=e.url+a,p=Object.assign({},e.headers);return $t(p,t),Ft(p,n),Mt(p,o),Ht(p,s),new Dt(h,e.method,p,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,i,u)}/**
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
 */function zt(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function Yt(...e){const t=zt();if(t!==void 0){const n=new t;for(let s=0;s<e.length;s++)n.append(e[s]);return n.getBlob()}else{if(le())return new Blob(e);throw new b(_.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Xt(e,t,n){return e.webkitSlice?e.webkitSlice(t,n):e.mozSlice?e.mozSlice(t,n):e.slice?e.slice(t,n):null}/**
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
 */function qt(e){if(typeof atob>"u")throw Ot("base-64");return atob(e)}/**
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
 */const L={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class se{constructor(t,n){this.data=t,this.contentType=n||null}}function Wt(e,t){switch(e){case L.RAW:return new se(Ue(t));case L.BASE64:case L.BASE64URL:return new se(Ie(e,t));case L.DATA_URL:return new se(Kt(t),Jt(t))}throw ae()}function Ue(e){const t=[];for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);if(s<=127)t.push(s);else if(s<=2047)t.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<e.length-1&&(e.charCodeAt(n+1)&64512)===56320))t.push(239,191,189);else{const o=s,i=e.charCodeAt(++n);s=65536|(o&1023)<<10|i&1023,t.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?t.push(239,191,189):t.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(t)}function Gt(e){let t;try{t=decodeURIComponent(e)}catch{throw G(L.DATA_URL,"Malformed data URL.")}return Ue(t)}function Ie(e,t){switch(e){case L.BASE64:{const r=t.indexOf("-")!==-1,o=t.indexOf("_")!==-1;if(r||o)throw G(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case L.BASE64URL:{const r=t.indexOf("+")!==-1,o=t.indexOf("/")!==-1;if(r||o)throw G(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=qt(t)}catch(r){throw r.message.includes("polyfill")?r:G(e,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class je{constructor(t){this.base64=!1,this.contentType=null;const n=t.match(/^data:([^,]+)?,/);if(n===null)throw G(L.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=Zt(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=t.substring(t.indexOf(",")+1)}}function Kt(e){const t=new je(e);return t.base64?Ie(L.BASE64,t.rest):Gt(t.rest)}function Jt(e){return new je(e).contentType}function Zt(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
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
 */class D{constructor(t,n){let s=0,r="";be(t)?(this.data_=t,s=t.size,r=t.type):t instanceof ArrayBuffer?(n?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),s=this.data_.length):t instanceof Uint8Array&&(n?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),s=t.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,n){if(be(this.data_)){const s=this.data_,r=Xt(s,t,n);return r===null?null:new D(r)}else{const s=new Uint8Array(this.data_.buffer,t,n-t);return new D(s,!0)}}static getBlob(...t){if(le()){const n=t.map(s=>s instanceof D?s.data_:s);return new D(Yt.apply(null,n))}else{const n=t.map(i=>Oe(i)?Wt(L.RAW,i).data:i.data_);let s=0;n.forEach(i=>{s+=i.byteLength});const r=new Uint8Array(s);let o=0;return n.forEach(i=>{for(let u=0;u<i.length;u++)r[o++]=i[u]}),new D(r,!0)}}uploadData(){return this.data_}}/**
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
 */function Qt(e){let t;try{t=JSON.parse(e)}catch{return null}return St(t)?t:null}/**
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
 */function en(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function tn(e,t){const n=t.split("/").filter(s=>s.length>0).join("/");return e.length===0?n:e+"/"+n}function Be(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
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
 */function nn(e,t){return t}class P{constructor(t,n,s,r){this.server=t,this.local=n||t,this.writable=!!s,this.xform=r||nn}}let Z=null;function sn(e){return!Oe(e)||e.length<2?e:Be(e)}function rn(){if(Z)return Z;const e=[];e.push(new P("bucket")),e.push(new P("generation")),e.push(new P("metageneration")),e.push(new P("name","fullPath",!0));function t(o,i){return sn(i)}const n=new P("name");n.xform=t,e.push(n);function s(o,i){return i!==void 0?Number(i):i}const r=new P("size");return r.xform=s,e.push(r),e.push(new P("timeCreated")),e.push(new P("updated")),e.push(new P("md5Hash",null,!0)),e.push(new P("cacheControl",null,!0)),e.push(new P("contentDisposition",null,!0)),e.push(new P("contentEncoding",null,!0)),e.push(new P("contentLanguage",null,!0)),e.push(new P("contentType",null,!0)),e.push(new P("metadata","customMetadata",!0)),Z=e,Z}function on(e,t){function n(){const s=e.bucket,r=e.fullPath,o=new B(s,r);return t._makeStorageReference(o)}Object.defineProperty(e,"ref",{get:n})}function an(e,t,n){const s={};s.type="file";const r=n.length;for(let o=0;o<r;o++){const i=n[o];s[i.local]=i.xform(s,t[i.server])}return on(s,e),s}function ln(e,t,n){const s=Qt(t);return s===null?null:an(e,s,n)}function cn(e,t){const n={},s=t.length;for(let r=0;r<s;r++){const o=t[r];o.writable&&(n[o.server]=e[o.local])}return JSON.stringify(n)}class Se{constructor(t,n,s,r){this.url=t,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
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
 */function un(e){if(!e)throw ae()}function dn(e,t){function n(s,r){const o=ln(e,r,t);return un(o!==null),o}return n}function Ce(e){function t(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=Rt():r=xt():n.getStatus()===402?r=yt(e.bucket):n.getStatus()===403?r=wt(e.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return t}function hn(e){const t=Ce(e);function n(s,r){let o=t(s,r);return s.getStatus()===404&&(o=bt(e.path)),o.serverResponse=r.serverResponse,o}return n}function pn(e,t){const n=t.fullServerUrl(),s=Pe(n,e.host,e._protocol),r="DELETE",o=e.maxOperationRetryTime;function i(a,h){}const u=new Se(s,r,i,o);return u.successCodes=[200,204],u.errorHandler=hn(t),u}function fn(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function mn(e,t,n){const s=Object.assign({},n);return s.fullPath=e.path,s.size=t.size(),s.contentType||(s.contentType=fn(null,t)),s}function gn(e,t,n,s,r){const o=t.bucketOnlyServerUrl(),i={"X-Goog-Upload-Protocol":"multipart"};function u(){let O="";for(let x=0;x<2;x++)O=O+Math.random().toString().slice(2);return O}const a=u();i["Content-Type"]="multipart/related; boundary="+a;const h=mn(t,s,r),p=cn(h,n),E="--"+a+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+p+`\r
--`+a+`\r
Content-Type: `+h.contentType+`\r
\r
`,k=`\r
--`+a+"--",N=D.getBlob(E,s,k);if(N===null)throw vt();const A={name:h.fullPath},m=Pe(o,e.host,e._protocol),y="POST",v=e.maxUploadRetryTime,U=new Se(m,y,dn(e,n),v);return U.urlParams=A,U.headers=i,U.body=N.uploadData(),U.errorHandler=Ce(t),U}/**
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
 */class _n{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=$.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=$.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=$.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,n,s,r,o){if(this.sent_)throw W("cannot .send() more than once");if(ke(t)&&s&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(n,t,!0),o!==void 0)for(const i in o)o.hasOwnProperty(i)&&this.xhr_.setRequestHeader(i,o[i].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw W("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw W("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw W("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw W("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class bn extends _n{initXhr(){this.xhr_.responseType="text"}}function Le(){return new bn}/**
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
 */class H{constructor(t,n){this._service=t,n instanceof B?this._location=n:this._location=B.makeFromUrl(n,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,n){return new H(t,n)}get root(){const t=new B(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return Be(this._location.path)}get storage(){return this._service}get parent(){const t=en(this._location.path);if(t===null)return null;const n=new B(this._location.bucket,t);return new H(this._service,n)}_throwIfRoot(t){if(this._location.path==="")throw Pt(t)}}function yn(e,t,n){e._throwIfRoot("uploadBytes");const s=gn(e.storage,e._location,rn(),new D(t,!0),n);return e.storage.makeRequestWithTokens(s,Le).then(r=>({metadata:r,ref:e}))}function xn(e){e._throwIfRoot("deleteObject");const t=pn(e.storage,e._location);return e.storage.makeRequestWithTokens(t,Le)}function Rn(e,t){const n=tn(e._location.path,t),s=new B(e._location.bucket,n);return new H(e.storage,s)}/**
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
 */function wn(e){return/^[A-Za-z]+:\/\//.test(e)}function Tn(e,t){return new H(e,t)}function De(e,t){if(e instanceof ce){const n=e;if(n._bucket==null)throw Et();const s=new H(n,n._bucket);return t!=null?De(s,t):s}else return t!==void 0?Rn(e,t):e}function kn(e,t){if(t&&wn(t)){if(e instanceof ce)return Tn(e,t);throw ie("To use ref(service, url), the first argument must be a Storage instance.")}else return De(e,t)}function xe(e,t){const n=t==null?void 0:t[Ee];return n==null?null:B.makeFromBucketSpec(n,e)}function Nn(e,t,n,s={}){e.host=`${t}:${n}`;const r=ke(t);r&&Ke(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:o}=s;o&&(e._overrideAuthToken=typeof o=="string"?o:Je(o,e.app.options.projectId))}class ce{constructor(t,n,s,r,o,i=!1){this.app=t,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=o,this._isUsingEmulator=i,this._bucket=null,this._host=Ae,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=gt,this._maxUploadRetryTime=_t,this._requests=new Set,r!=null?this._bucket=B.makeFromBucketSpec(r,this._host):this._bucket=xe(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=B.makeFromBucketSpec(this._url,t):this._bucket=xe(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){ye("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){ye("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const n=await t.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){if(We(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new H(this,t)}_makeRequest(t,n,s,r,o=!0){if(this._deleted)return new Ut(ve());{const i=Vt(t,this._appId,s,r,n,this._firebaseVersion,o,this._isUsingEmulator);return this._requests.add(i),i.getPromise().then(()=>this._requests.delete(i),()=>this._requests.delete(i)),i}}async makeRequestWithTokens(t,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,n,s,r).getPromise()}}const Re="@firebase/storage",we="0.14.4";/**
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
 */const Fe="storage";function An(e,t,n){return e=ee(e),yn(e,t,n)}function En(e){return e=ee(e),xn(e)}function Me(e,t){return e=ee(e),kn(e,t)}function vn(e=qe(),t){e=ee(e);const s=Ye(e,Fe).getImmediate({identifier:t}),r=Xe("storage");return r&&On(s,...r),s}function On(e,t,n,s={}){Nn(e,t,n,s)}/**
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
 */function Pn(e,{instanceIdentifier:t}){const n=e.getProvider("app").getImmediate(),s=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new ce(n,s,r,t,et)}function Un(){Ze(new Qe(Fe,Pn,"PUBLIC").setMultipleInstances(!0)),fe(Re,we,""),fe(Re,we,"esm2020")}Un();let re=null;function In(){const e=globalThis.crypto;return e&&typeof e.randomUUID=="function"?e.randomUUID():`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}function $e(){return re||(re=vn(tt)),re}async function jn({uid:e,file:t}){const n=Ne(t,{types:Q,maxBytes:oe,exclusive:!0});if(n)throw new Error(n);const s=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=In(),o=`profile-photos/${e}/${r}/photo.${s}`;return await An(Me($e(),o),t,{contentType:t.type}),{path:o}}async function Bn(e){if(!(typeof e!="string"||!e.startsWith("profile-photos/")))try{await En(Me($e(),e))}catch{}}const Sn=g.forwardRef(function({uid:t,value:n,onChange:s,onPendingChange:r},o){const i=g.useRef(null),[u,a]=g.useState(null),[h,p]=g.useState(!1),[E,k]=g.useState(null),[N,A]=g.useState(null),[m,y]=g.useState(null);g.useEffect(()=>()=>{m&&URL.revokeObjectURL(m)},[m]);function v(R){r==null||r(R)}function U(R){const j=URL.createObjectURL(R);y(F=>(F&&URL.revokeObjectURL(F),j))}function O(R){a(null),k(null),A(R),U(R),v(!1),i.current&&(i.current.value="")}g.useImperativeHandle(o,()=>({hasPending(){return N!==null},async commit(){if(!N)return null;p(!0),r==null||r(!0),a(null);try{const{path:R}=await jn({uid:t,file:N});return s(R),A(null),R}catch(R){throw a("Your photo could not be uploaded. Try again."),R}finally{p(!1),r==null||r(!1)}}}),[s,r,N,t]);async function x(R){var C;const j=((C=R.target.files)==null?void 0:C[0])??null;if(!j)return;const F=Ne(j,{types:Q,maxBytes:oe,exclusive:!0});if(F){a(F),i.current&&(i.current.value="");return}i.current&&(i.current.value=""),k(j),v(!0)}function I(){m&&URL.revokeObjectURL(m),y(null),A(null),s("")}const S=nt(n);return l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("span",{className:"block font-semibold text-text-primary",children:"Photo"}),l.jsxs("div",{className:"flex items-center gap-4",children:[m?l.jsx("img",{src:m,alt:"Your new profile photo",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):n&&!S?l.jsx(st,{path:n,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):S?l.jsx("img",{src:S,alt:"Your chosen default avatar",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):l.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-text-primary/20 text-xs text-text-secondary",children:"None"}),l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("label",{htmlFor:"profile-photo",className:"file-input-label touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-text-primary/20 bg-surface px-4 py-2 font-semibold text-text-primary hover:bg-surface-alt",children:h?"Uploading…":n||N?"Replace photo":"Upload a photo"}),l.jsx("input",{id:"profile-photo",ref:i,type:"file",accept:Q.join(","),className:"sr-only",disabled:h,onChange:x,"aria-describedby":"profile-photo-hint"}),n||N?l.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-text-secondary underline hover:bg-surface-alt",onClick:I,disabled:h,children:"Remove photo"}):null]})]}),E?l.jsx(ht,{file:E,label:"your profile photo",onApply:R=>O(R),onCancel:()=>{k(null),v(!1)}}):null,l.jsx(pt,{value:n,onChange:s,namePrefix:"profile"}),l.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-text-secondary",children:[Q.map(rt).join(", ")," · up to"," ",ot(oe),". Save your profile to publish the change."]}),u?l.jsx("p",{role:"alert",className:"text-sm text-danger",children:u}):null]})}),Te={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function Cn(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id,maxPicks:Number.isInteger(n.maxPicks)&&n.maxPicks>0?n.maxPicks:null,badges:(Array.isArray(n.badges)?n.badges:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id}))})).filter(n=>n.badges.length>0)}const Ln=5;function Dn(e){return e.reduce((t,n)=>t+Math.min(n.maxPicks??n.badges.length,n.badges.length),0)}function Hn(){const{user:e}=it(),{features:t,badges:n}=at(),{profile:s,status:r,needsProfileSetup:o,saveProfile:i}=lt(),{showToast:u}=ct(),[a,h]=g.useState(null),[p,E]=g.useState(!1),[k,N]=g.useState(!1),A=g.useRef(null),[m,y]=g.useState(null),[v,U]=g.useState(null),O=g.useRef(null),x=g.useRef([]),I=g.useRef([]),S=g.useRef([]);if(g.useEffect(()=>{a!=null||s==null||(I.current=Array.isArray(s.customBadges)?s.customBadges:[],S.current=I.current,h({displayName:s.displayName??"",pronouns:s.pronouns??"",jobTitle:s.jobTitle??"",organization:s.organization??"",bio:s.bio??"",profileVisibility:s.profileVisibility??"attendees_only",badges:Array.isArray(s.badges)?s.badges:[],customBadges:Array.from({length:z.MAX_CUSTOM_BADGES},(c,d)=>{var f;return typeof((f=s.customBadges)==null?void 0:f[d])=="string"?s.customBadges[d]:""}),photoPath:typeof s.photoPath=="string"?s.photoPath:""}))},[s,a]),g.useEffect(()=>{if(!s)return;const c=T=>typeof T=="string"?T.trim().replace(/\s+/g," ").toLowerCase():"",d=Array.isArray(s.customBadges)?s.customBadges:[],f=new Set(d.map(c)),w=new Set(S.current.map(c).filter(T=>!f.has(T)));S.current=d,w.size&&(I.current=I.current.filter(T=>!w.has(c(T))),h(T=>T&&{...T,customBadges:T.customBadges.map(X=>w.has(c(X))?"":X)}))},[s]),!e)return l.jsx(me,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:l.jsx(ut,{to:"/signin",className:ge,children:"Go to sign in"})});if(r==="pending-account"||a==null)return l.jsx(me,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const R=dt.PROFILE_VISIBILITIES.filter(c=>c!=="public"||t.publicAttendeeProfiles||a.profileVisibility==="public"),j=t.badges?Cn(n):[],F=z.MAX_TOTAL_BADGES-Dn(j)<=Ln,C=(c,d)=>h(f=>({...f,[c]:d})),He=c=>h(d=>({...d,badges:d.badges.includes(c)?d.badges.filter(f=>f!==c):[...d.badges,c]})),Ve=(c,d)=>{h(f=>({...f,customBadges:f.customBadges.map((w,T)=>T===c?d:w)})),U(null)},ze=async c=>{var ue,de,he;if(c.preventDefault(),k||p)return;if(a.displayName.trim().length===0){y("Enter the name you want other attendees to see."),(ue=O.current)==null||ue.focus();return}y(null);let d;const f=M=>M.filter(V=>typeof V=="string"&&V.trim().length>0),w=f(a.customBadges),T=f(I.current),X=JSON.stringify(w)!==JSON.stringify(T);if(t.customBadges===!0){const M=z.validateCustomBadges(w,{blockList:n==null?void 0:n.customBadgeBlockList});if(M.rejected.length>0){let V=0,te=[];for(let K=0;K<a.customBadges.length;K+=1){const pe=a.customBadges[K];if(pe.trim()&&(te=[...te,pe],z.validateCustomBadges(te,{blockList:n==null?void 0:n.customBadgeBlockList}).rejected.length>0)){V=K;break}}U({index:V,message:"Choose another custom badge. Use 24 characters or fewer, use only letters, numbers, spaces, apostrophes, hyphens, or periods, and do not use a blocked or repeated badge."}),(de=x.current[V])==null||de.focus();return}d=M.valid}U(null),E(!0);let q=null;try{let M=a.photoPath?a.photoPath:null;if((he=A.current)!=null&&he.hasPending()){try{q=await A.current.commit()}catch{u("Your photo could not be uploaded. Try again.",{tone:"error"});return}M=q}await i({displayName:a.displayName.trim(),pronouns:a.pronouns.trim(),jobTitle:a.jobTitle.trim(),organization:a.organization.trim(),bio:a.bio.trim(),profileVisibility:a.profileVisibility,badges:a.badges,...t.customBadges===!0&&X?{customBadges:d}:{},photoPath:M}),t.customBadges===!0&&X&&(I.current=d),u("Profile saved.")}catch{q&&q!==(s==null?void 0:s.photoPath)&&await Bn(q),u("Your profile could not be saved. Try again.",{tone:"error"})}finally{E(!1)}};return l.jsxs("article",{className:"mx-auto max-w-2xl",children:[l.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:o?"Complete your profile":"Your profile"}),l.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),l.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:ze,noValidate:!0,children:[l.jsx(Sn,{ref:A,uid:e.uid,value:a.photoPath,onChange:c=>C("photoPath",c),onPendingChange:N}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),l.jsx("input",{id:"displayName",ref:O,className:`mt-2xs ${Y}`,value:a.displayName,onChange:c=>C("displayName",c.target.value),"aria-invalid":m?"true":void 0,"aria-describedby":m?"displayName-error":void 0,autoComplete:"name"}),m?l.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:m}):null]}),l.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[l.jsxs("div",{children:[l.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),l.jsx("input",{id:"pronouns",className:`mt-2xs ${Y}`,value:a.pronouns,onChange:c=>C("pronouns",c.target.value)})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),l.jsx("input",{id:"jobTitle",className:`mt-2xs ${Y}`,value:a.jobTitle,onChange:c=>C("jobTitle",c.target.value),autoComplete:"organization-title"})]})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),l.jsx("input",{id:"organization",className:`mt-2xs ${Y}`,value:a.organization,onChange:c=>C("organization",c.target.value),autoComplete:"organization"})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),l.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${Y}`,value:a.bio,onChange:c=>C("bio",c.target.value)})]}),l.jsxs("fieldset",{children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),l.jsx("div",{className:"mt-xs space-y-xs",children:R.map(c=>l.jsx(ft,{name:"profileVisibility",value:c,label:Te[c].label,description:Te[c].description,checked:a.profileVisibility===c,onChange:()=>C("profileVisibility",c)},c))})]}),j.length>0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(_e,{level:2,title:"Badges"}),F?l.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",z.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,j.map(c=>{const d=c.badges.filter(w=>a.badges.includes(w.id)).length,f=c.maxPicks!=null&&d>=c.maxPicks;return l.jsxs("fieldset",{className:"mt-md",children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:c.label}),c.maxPicks!=null?l.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:f?`You’ve picked all ${c.maxPicks} — clear one to choose another.`:`Pick up to ${c.maxPicks} (${d} chosen).`}):null,l.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:c.badges.map(w=>{const T=a.badges.includes(w.id);return l.jsx(mt,{label:w.label,checked:T,disabled:!T&&f,className:!T&&f?"text-text-secondary":"",onChange:()=>He(w.id)},w.id)})})]},c.id)})]}):null,t.customBadges===!0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(_e,{level:2,title:"Custom badges"}),l.jsx("div",{className:"mt-md grid gap-md sm:grid-cols-3",children:a.customBadges.map((c,d)=>{const f=(v==null?void 0:v.index)===d?v.message:null;return l.jsxs("div",{children:[l.jsxs("label",{htmlFor:`customBadge-${d}`,className:"block font-semibold text-text-primary",children:["Custom badge ",d+1]}),l.jsx("input",{id:`customBadge-${d}`,ref:w=>{x.current[d]=w},className:`mt-2xs ${Y}`,value:c,maxLength:z.MAX_CUSTOM_BADGE_LENGTH,onChange:w=>Ve(d,w.target.value),"aria-invalid":f?"true":void 0,"aria-describedby":f?`customBadge-${d}-error`:void 0}),f?l.jsx("p",{id:`customBadge-${d}-error`,role:"alert",className:"mt-2xs font-data text-caption text-danger",children:f}):null]},d)})})]}):null,l.jsx("button",{type:"submit",className:ge,disabled:p||k,children:p?"Saving…":"Save profile"})]})]})}export{Hn as default};
