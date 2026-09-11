import{aT as K,aU as $e,aV as Ve,aW as He,aX as ze,aY as qe,aZ as xe,a_ as Xe,a$ as We,b0 as Ye,b1 as Ge,b2 as ue,b3 as Ke,v as Re,b4 as G,b5 as ne,b6 as Ze,r as A,aQ as Je,j as l,A as Qe,q as et,p as tt,a as nt,u as st,ax as rt,g as ot,b7 as $,ag as de,L as it,ah as he,b8 as at,an as V,at as pe}from"./index-rDTCFwHA.js";import{P as lt,D as ct}from"./DefaultAvatarPicker-BmW0HhIQ.js";import{R as ut,C as dt}from"./Choice-KYmz2I28.js";/**
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
 */const Te="firebasestorage.googleapis.com",we="storageBucket",ht=2*60*1e3,pt=10*60*1e3;/**
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
 */class g extends qe{constructor(t,s,n=0){super(Q(t),`Firebase Storage: ${s} (${Q(t)})`),this.status_=n,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,g.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return Q(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var m;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(m||(m={}));function Q(e){return"storage/"+e}function re(){const e="An unknown error occurred, please check the error payload for server response.";return new g(m.UNKNOWN,e)}function ft(e){return new g(m.OBJECT_NOT_FOUND,"Object '"+e+"' does not exist.")}function mt(e){return new g(m.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function gt(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new g(m.UNAUTHENTICATED,e)}function bt(){return new g(m.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function _t(e){return new g(m.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function yt(){return new g(m.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function xt(){return new g(m.CANCELED,"User canceled the upload/download.")}function Rt(e){return new g(m.INVALID_URL,"Invalid URL '"+e+"'.")}function Tt(e){return new g(m.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function wt(){return new g(m.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+we+"' property when initializing the app?")}function kt(){return new g(m.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function Nt(e){return new g(m.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function se(e){return new g(m.INVALID_ARGUMENT,e)}function ke(){return new g(m.APP_DELETED,"The Firebase app was deleted.")}function At(e){return new g(m.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function q(e,t){return new g(m.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function z(e){throw new g(m.INTERNAL_ERROR,"Internal error: "+e)}/**
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
 */class O{constructor(t,s){this.bucket=t,this.path_=s}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,s){let n;try{n=O.makeFromUrl(t,s)}catch{return new O(t,"")}if(n.path==="")return n;throw Tt(t)}static makeFromUrl(t,s){let n=null;const r="([A-Za-z0-9.\\-_]+)";function o(T){T.path.charAt(T.path.length-1)==="/"&&(T.path_=T.path_.slice(0,-1))}const a="(/(.*))?$",u=new RegExp("^gs://"+r+a,"i"),i={bucket:1,path:3};function h(T){T.path_=decodeURIComponent(T.path)}const f="v[A-Za-z0-9_]+",E=s.replace(/[.]/g,"\\."),w="(/([^?#]*).*)?$",k=new RegExp(`^https?://${E}/${f}/b/${r}/o${w}`,"i"),_={bucket:1,path:3},R=s===Te?"(?:storage.googleapis.com|storage.cloud.google.com)":s,b="([^?#]*)",C=new RegExp(`^https?://${R}/${r}/${b}`,"i"),v=[{regex:u,indices:i,postModify:o},{regex:k,indices:_,postModify:h},{regex:C,indices:{bucket:1,path:2},postModify:h}];for(let T=0;T<v.length;T++){const M=v[T],D=M.regex.exec(t);if(D){const Z=D[M.indices.bucket];let B=D[M.indices.path];B||(B=""),n=new O(Z,B),M.postModify(n);break}}if(n==null)throw Rt(t);return n}}class Et{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
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
 */function Pt(e,t,s){let n=1,r=null,o=null,a=!1,u=0;function i(){return u===2}let h=!1;function f(...b){h||(h=!0,t.apply(null,b))}function E(b){r=setTimeout(()=>{r=null,e(k,i())},b)}function w(){o&&clearTimeout(o)}function k(b,...C){if(h){w();return}if(b){w(),f.call(null,b,...C);return}if(i()||a){w(),f.call(null,b,...C);return}n<64&&(n*=2);let v;u===1?(u=2,v=0):v=(n+Math.random())*1e3,E(v)}let _=!1;function R(b){_||(_=!0,w(),!h&&(r!==null?(b||(u=2),clearTimeout(r),E(0)):b||(u=1)))}return E(0),o=setTimeout(()=>{a=!0,R(!0)},s),R}function vt(e){e(!1)}/**
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
 */function Ot(e){return e!==void 0}function Ct(e){return typeof e=="object"&&!Array.isArray(e)}function Ne(e){return typeof e=="string"||e instanceof String}function fe(e){return oe()&&e instanceof Blob}function oe(){return typeof Blob<"u"}function me(e,t,s,n){if(n<t)throw se(`Invalid value for '${e}'. Expected ${t} or greater.`);if(n>s)throw se(`Invalid value for '${e}'. Expected ${s} or less.`)}/**
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
 */function Ae(e,t,s){let n=t;return s==null&&(n=`https://${t}`),`${s}://${n}/v0${e}`}function Bt(e){const t=encodeURIComponent;let s="?";for(const n in e)if(e.hasOwnProperty(n)){const r=t(n)+"="+t(e[n]);s=s+r+"&"}return s=s.slice(0,-1),s}var L;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})(L||(L={}));/**
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
 */function It(e,t){const s=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,o=t.indexOf(e)!==-1;return s||r||o}/**
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
 */class Ut{constructor(t,s,n,r,o,a,u,i,h,f,E,w=!0,k=!1){this.url_=t,this.method_=s,this.headers_=n,this.body_=r,this.successCodes_=o,this.additionalRetryCodes_=a,this.callback_=u,this.errorCallback_=i,this.timeout_=h,this.progressCallback_=f,this.connectionFactory_=E,this.retry=w,this.isUsingEmulator=k,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((_,R)=>{this.resolve_=_,this.reject_=R,this.start_()})}start_(){const t=(n,r)=>{if(r){n(!1,new W(!1,null,!0));return}const o=this.connectionFactory_();this.pendingConnection_=o;const a=u=>{const i=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(i,h)};this.progressCallback_!==null&&o.addUploadProgressListener(a),o.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&o.removeUploadProgressListener(a),this.pendingConnection_=null;const u=o.getErrorCode()===L.NO_ERROR,i=o.getStatus();if(!u||It(i,this.additionalRetryCodes_)&&this.retry){const f=o.getErrorCode()===L.ABORT;n(!1,new W(!1,null,f));return}const h=this.successCodes_.indexOf(i)!==-1;n(!0,new W(h,o))})},s=(n,r)=>{const o=this.resolve_,a=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const i=this.callback_(u,u.getResponse());Ot(i)?o(i):o()}catch(i){a(i)}else if(u!==null){const i=re();i.serverResponse=u.getErrorText(),this.errorCallback_?a(this.errorCallback_(u,i)):a(i)}else if(r.canceled){const i=this.appDelete_?ke():xt();a(i)}else{const i=yt();a(i)}};this.canceled_?s(!1,new W(!1,null,!0)):this.backoffId_=Pt(t,s,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&vt(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class W{constructor(t,s,n){this.wasSuccessCode=t,this.connection=s,this.canceled=!!n}}function jt(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function St(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function Dt(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Lt(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function Ft(e,t,s,n,r,o,a=!0,u=!1){const i=Bt(e.urlParams),h=e.url+i,f=Object.assign({},e.headers);return Dt(f,t),jt(f,s),St(f,o),Lt(f,n),new Ut(h,e.method,f,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,a,u)}/**
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
 */function Mt(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function $t(...e){const t=Mt();if(t!==void 0){const s=new t;for(let n=0;n<e.length;n++)s.append(e[n]);return s.getBlob()}else{if(oe())return new Blob(e);throw new g(m.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Vt(e,t,s){return e.webkitSlice?e.webkitSlice(t,s):e.mozSlice?e.mozSlice(t,s):e.slice?e.slice(t,s):null}/**
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
 */function Ht(e){if(typeof atob>"u")throw Nt("base-64");return atob(e)}/**
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
 */const I={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class ee{constructor(t,s){this.data=t,this.contentType=s||null}}function zt(e,t){switch(e){case I.RAW:return new ee(Ee(t));case I.BASE64:case I.BASE64URL:return new ee(Pe(e,t));case I.DATA_URL:return new ee(Xt(t),Wt(t))}throw re()}function Ee(e){const t=[];for(let s=0;s<e.length;s++){let n=e.charCodeAt(s);if(n<=127)t.push(n);else if(n<=2047)t.push(192|n>>6,128|n&63);else if((n&64512)===55296)if(!(s<e.length-1&&(e.charCodeAt(s+1)&64512)===56320))t.push(239,191,189);else{const o=n,a=e.charCodeAt(++s);n=65536|(o&1023)<<10|a&1023,t.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|n&63)}else(n&64512)===56320?t.push(239,191,189):t.push(224|n>>12,128|n>>6&63,128|n&63)}return new Uint8Array(t)}function qt(e){let t;try{t=decodeURIComponent(e)}catch{throw q(I.DATA_URL,"Malformed data URL.")}return Ee(t)}function Pe(e,t){switch(e){case I.BASE64:{const r=t.indexOf("-")!==-1,o=t.indexOf("_")!==-1;if(r||o)throw q(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case I.BASE64URL:{const r=t.indexOf("+")!==-1,o=t.indexOf("/")!==-1;if(r||o)throw q(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let s;try{s=Ht(t)}catch(r){throw r.message.includes("polyfill")?r:q(e,"Invalid character found")}const n=new Uint8Array(s.length);for(let r=0;r<s.length;r++)n[r]=s.charCodeAt(r);return n}class ve{constructor(t){this.base64=!1,this.contentType=null;const s=t.match(/^data:([^,]+)?,/);if(s===null)throw q(I.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const n=s[1]||null;n!=null&&(this.base64=Yt(n,";base64"),this.contentType=this.base64?n.substring(0,n.length-7):n),this.rest=t.substring(t.indexOf(",")+1)}}function Xt(e){const t=new ve(e);return t.base64?Pe(I.BASE64,t.rest):qt(t.rest)}function Wt(e){return new ve(e).contentType}function Yt(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
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
 */class S{constructor(t,s){let n=0,r="";fe(t)?(this.data_=t,n=t.size,r=t.type):t instanceof ArrayBuffer?(s?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),n=this.data_.length):t instanceof Uint8Array&&(s?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),n=t.length),this.size_=n,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,s){if(fe(this.data_)){const n=this.data_,r=Vt(n,t,s);return r===null?null:new S(r)}else{const n=new Uint8Array(this.data_.buffer,t,s-t);return new S(n,!0)}}static getBlob(...t){if(oe()){const s=t.map(n=>n instanceof S?n.data_:n);return new S($t.apply(null,s))}else{const s=t.map(a=>Ne(a)?zt(I.RAW,a).data:a.data_);let n=0;s.forEach(a=>{n+=a.byteLength});const r=new Uint8Array(n);let o=0;return s.forEach(a=>{for(let u=0;u<a.length;u++)r[o++]=a[u]}),new S(r,!0)}}uploadData(){return this.data_}}/**
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
 */function Gt(e){let t;try{t=JSON.parse(e)}catch{return null}return Ct(t)?t:null}/**
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
 */function Kt(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function Zt(e,t){const s=t.split("/").filter(n=>n.length>0).join("/");return e.length===0?s:e+"/"+s}function Oe(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
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
 */function Jt(e,t){return t}class N{constructor(t,s,n,r){this.server=t,this.local=s||t,this.writable=!!n,this.xform=r||Jt}}let Y=null;function Qt(e){return!Ne(e)||e.length<2?e:Oe(e)}function en(){if(Y)return Y;const e=[];e.push(new N("bucket")),e.push(new N("generation")),e.push(new N("metageneration")),e.push(new N("name","fullPath",!0));function t(o,a){return Qt(a)}const s=new N("name");s.xform=t,e.push(s);function n(o,a){return a!==void 0?Number(a):a}const r=new N("size");return r.xform=n,e.push(r),e.push(new N("timeCreated")),e.push(new N("updated")),e.push(new N("md5Hash",null,!0)),e.push(new N("cacheControl",null,!0)),e.push(new N("contentDisposition",null,!0)),e.push(new N("contentEncoding",null,!0)),e.push(new N("contentLanguage",null,!0)),e.push(new N("contentType",null,!0)),e.push(new N("metadata","customMetadata",!0)),Y=e,Y}function tn(e,t){function s(){const n=e.bucket,r=e.fullPath,o=new O(n,r);return t._makeStorageReference(o)}Object.defineProperty(e,"ref",{get:s})}function nn(e,t,s){const n={};n.type="file";const r=s.length;for(let o=0;o<r;o++){const a=s[o];n[a.local]=a.xform(n,t[a.server])}return tn(n,e),n}function sn(e,t,s){const n=Gt(t);return n===null?null:nn(e,n,s)}function rn(e,t){const s={},n=t.length;for(let r=0;r<n;r++){const o=t[r];o.writable&&(s[o.server]=e[o.local])}return JSON.stringify(s)}class Ce{constructor(t,s,n,r){this.url=t,this.method=s,this.handler=n,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
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
 */function on(e){if(!e)throw re()}function an(e,t){function s(n,r){const o=sn(e,r,t);return on(o!==null),o}return s}function Be(e){function t(s,n){let r;return s.getStatus()===401?s.getErrorText().includes("Firebase App Check token is invalid")?r=bt():r=gt():s.getStatus()===402?r=mt(e.bucket):s.getStatus()===403?r=_t(e.path):r=n,r.status=s.getStatus(),r.serverResponse=n.serverResponse,r}return t}function ln(e){const t=Be(e);function s(n,r){let o=t(n,r);return n.getStatus()===404&&(o=ft(e.path)),o.serverResponse=r.serverResponse,o}return s}function cn(e,t){const s=t.fullServerUrl(),n=Ae(s,e.host,e._protocol),r="DELETE",o=e.maxOperationRetryTime;function a(i,h){}const u=new Ce(n,r,a,o);return u.successCodes=[200,204],u.errorHandler=ln(t),u}function un(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function dn(e,t,s){const n=Object.assign({},s);return n.fullPath=e.path,n.size=t.size(),n.contentType||(n.contentType=un(null,t)),n}function hn(e,t,s,n,r){const o=t.bucketOnlyServerUrl(),a={"X-Goog-Upload-Protocol":"multipart"};function u(){let v="";for(let T=0;T<2;T++)v=v+Math.random().toString().slice(2);return v}const i=u();a["Content-Type"]="multipart/related; boundary="+i;const h=dn(t,n,r),f=rn(h,s),E="--"+i+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+f+`\r
--`+i+`\r
Content-Type: `+h.contentType+`\r
\r
`,w=`\r
--`+i+"--",k=S.getBlob(E,n,w);if(k===null)throw kt();const _={name:h.fullPath},R=Ae(o,e.host,e._protocol),b="POST",C=e.maxUploadRetryTime,P=new Ce(R,b,an(e,s),C);return P.urlParams=_,P.headers=a,P.body=k.uploadData(),P.errorHandler=Be(t),P}/**
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
 */class pn{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=L.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=L.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=L.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,s,n,r,o){if(this.sent_)throw z("cannot .send() more than once");if(xe(t)&&n&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(s,t,!0),o!==void 0)for(const a in o)o.hasOwnProperty(a)&&this.xhr_.setRequestHeader(a,o[a].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw z("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw z("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw z("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw z("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class fn extends pn{initXhr(){this.xhr_.responseType="text"}}function Ie(){return new fn}/**
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
 */class F{constructor(t,s){this._service=t,s instanceof O?this._location=s:this._location=O.makeFromUrl(s,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,s){return new F(t,s)}get root(){const t=new O(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return Oe(this._location.path)}get storage(){return this._service}get parent(){const t=Kt(this._location.path);if(t===null)return null;const s=new O(this._location.bucket,t);return new F(this._service,s)}_throwIfRoot(t){if(this._location.path==="")throw At(t)}}function mn(e,t,s){e._throwIfRoot("uploadBytes");const n=hn(e.storage,e._location,en(),new S(t,!0),s);return e.storage.makeRequestWithTokens(n,Ie).then(r=>({metadata:r,ref:e}))}function gn(e){e._throwIfRoot("deleteObject");const t=cn(e.storage,e._location);return e.storage.makeRequestWithTokens(t,Ie)}function bn(e,t){const s=Zt(e._location.path,t),n=new O(e._location.bucket,s);return new F(e.storage,n)}/**
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
 */function _n(e){return/^[A-Za-z]+:\/\//.test(e)}function yn(e,t){return new F(e,t)}function Ue(e,t){if(e instanceof ie){const s=e;if(s._bucket==null)throw wt();const n=new F(s,s._bucket);return t!=null?Ue(n,t):n}else return t!==void 0?bn(e,t):e}function xn(e,t){if(t&&_n(t)){if(e instanceof ie)return yn(e,t);throw se("To use ref(service, url), the first argument must be a Storage instance.")}else return Ue(e,t)}function ge(e,t){const s=t==null?void 0:t[we];return s==null?null:O.makeFromBucketSpec(s,e)}function Rn(e,t,s,n={}){e.host=`${t}:${s}`;const r=xe(t);r&&Xe(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:o}=n;o&&(e._overrideAuthToken=typeof o=="string"?o:We(o,e.app.options.projectId))}class ie{constructor(t,s,n,r,o,a=!1){this.app=t,this._authProvider=s,this._appCheckProvider=n,this._url=r,this._firebaseVersion=o,this._isUsingEmulator=a,this._bucket=null,this._host=Te,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=ht,this._maxUploadRetryTime=pt,this._requests=new Set,r!=null?this._bucket=O.makeFromBucketSpec(r,this._host):this._bucket=ge(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=O.makeFromBucketSpec(this._url,t):this._bucket=ge(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){me("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){me("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const s=await t.getToken();if(s!==null)return s.accessToken}return null}async _getAppCheckToken(){if(ze(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new F(this,t)}_makeRequest(t,s,n,r,o=!0){if(this._deleted)return new Et(ke());{const a=Ft(t,this._appId,n,r,s,this._firebaseVersion,o,this._isUsingEmulator);return this._requests.add(a),a.getPromise().then(()=>this._requests.delete(a),()=>this._requests.delete(a)),a}}async makeRequestWithTokens(t,s){const[n,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,s,n,r).getPromise()}}const be="@firebase/storage",_e="0.14.4";/**
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
 */const je="storage";function Tn(e,t,s){return e=K(e),mn(e,t,s)}function wn(e){return e=K(e),gn(e)}function Se(e,t){return e=K(e),xn(e,t)}function kn(e=He(),t){e=K(e);const n=$e(e,je).getImmediate({identifier:t}),r=Ve("storage");return r&&Nn(n,...r),n}function Nn(e,t,s,n={}){Rn(e,t,s,n)}/**
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
 */function An(e,{instanceIdentifier:t}){const s=e.getProvider("app").getImmediate(),n=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new ie(s,n,r,t,Ke)}function En(){Ye(new Ge(je,An,"PUBLIC").setMultipleInstances(!0)),ue(be,_e,""),ue(be,_e,"esm2020")}En();let te=null;function De(){return te||(te=kn(Ze)),te}async function Pn({uid:e,file:t}){const s=Re(t,{types:G,maxBytes:ne,exclusive:!0});if(s)throw new Error(s);const n=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=`profile-photos/${e}/photo.${n}`;return await Tn(Se(De(),r),t,{contentType:t.type}),{path:r}}async function vn(e){if(!(typeof e!="string"||!e.startsWith("profile-photos/")))try{await wn(Se(De(),e))}catch{}}function On({uid:e,value:t,onChange:s}){const n=A.useRef(null),[r,o]=A.useState(null),[a,u]=A.useState(!1),[i,h]=A.useState(null);async function f(_){u(!0),o(null);try{const{path:R}=await Pn({uid:e,file:_});s(R)}catch{o("Your photo could not be uploaded. Try again.")}finally{u(!1),h(null),n.current&&(n.current.value="")}}async function E(_){var C;const R=((C=_.target.files)==null?void 0:C[0])??null;if(!R)return;const b=Re(R,{types:G,maxBytes:ne,exclusive:!0});if(b){o(b),n.current&&(n.current.value="");return}n.current&&(n.current.value=""),h(R)}function w(){s("")}const k=Je(t);return l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("span",{className:"block font-semibold text-brand-ink",children:"Photo"}),l.jsxs("div",{className:"flex items-center gap-4",children:[t&&!k?l.jsx(Qe,{path:t,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):k?l.jsx("img",{src:k,alt:"Your chosen default avatar",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):l.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-brand-ink/20 text-xs text-brand-ink-muted",children:"None"}),l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("label",{htmlFor:"profile-photo",className:"touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt",children:a?"Uploading…":t?"Replace photo":"Upload a photo"}),l.jsx("input",{id:"profile-photo",ref:n,type:"file",accept:G.join(","),className:"sr-only",disabled:a,onChange:E,"aria-describedby":"profile-photo-hint"}),t?l.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-brand-ink-muted underline hover:bg-brand-surface-alt",onClick:w,disabled:a,children:"Remove photo"}):null]})]}),i?l.jsx(lt,{file:i,label:"your profile photo",onApply:_=>f(_),onCancel:()=>h(null)}):null,l.jsx(ct,{value:t,onChange:s,namePrefix:"profile"}),l.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-brand-ink-muted",children:[G.map(et).join(", ")," · up to"," ",tt(ne),". Save your profile to publish the change."]}),r?l.jsx("p",{role:"alert",className:"text-sm text-danger",children:r}):null]})}const ye={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function Cn(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id,maxPicks:Number.isInteger(s.maxPicks)&&s.maxPicks>0?s.maxPicks:null,badges:(Array.isArray(s.badges)?s.badges:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id}))})).filter(s=>s.badges.length>0)}const Bn=5;function In(e){return e.reduce((t,s)=>t+Math.min(s.maxPicks??s.badges.length,s.badges.length),0)}function Dn(){const{user:e}=nt(),{features:t,badges:s}=st(),{profile:n,status:r,needsProfileSetup:o,saveProfile:a}=rt(),{showToast:u}=ot(),[i,h]=A.useState(null),[f,E]=A.useState(!1),[w,k]=A.useState(null),[_,R]=A.useState(null),b=A.useRef(null),C=A.useRef([]),P=A.useRef([]),v=A.useRef([]),T=A.useRef(null);if(A.useEffect(()=>{i!=null||n==null||(P.current=Array.isArray(n.customBadges)?n.customBadges:[],v.current=P.current,h({displayName:n.displayName??"",pronouns:n.pronouns??"",jobTitle:n.jobTitle??"",organization:n.organization??"",bio:n.bio??"",profileVisibility:n.profileVisibility??"attendees_only",badges:Array.isArray(n.badges)?n.badges:[],customBadges:Array.from({length:$.MAX_CUSTOM_BADGES},(c,d)=>{var p;return typeof((p=n.customBadges)==null?void 0:p[d])=="string"?n.customBadges[d]:""}),photoPath:typeof n.photoPath=="string"?n.photoPath:""}),T.current=typeof n.photoPath=="string"?n.photoPath:null)},[n,i]),A.useEffect(()=>{if(!n)return;const c=x=>typeof x=="string"?x.trim().replace(/\s+/g," ").toLowerCase():"",d=Array.isArray(n.customBadges)?n.customBadges:[],p=new Set(d.map(c)),y=new Set(v.current.map(c).filter(x=>!p.has(x)));v.current=d,y.size&&(P.current=P.current.filter(x=>!y.has(c(x))),h(x=>x&&{...x,customBadges:x.customBadges.map(H=>y.has(c(H))?"":H)}))},[n]),!e)return l.jsx(de,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:l.jsx(it,{to:"/signin",className:he,children:"Go to sign in"})});if(r==="pending-account"||i==null)return l.jsx(de,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const M=at.PROFILE_VISIBILITIES.filter(c=>c!=="public"||t.publicAttendeeProfiles||i.profileVisibility==="public"),D=t.badges?Cn(s):[],Z=$.MAX_TOTAL_BADGES-In(D)<=Bn,B=(c,d)=>h(p=>({...p,[c]:d})),Le=c=>h(d=>({...d,badges:d.badges.includes(c)?d.badges.filter(p=>p!==c):[...d.badges,c]})),Fe=(c,d)=>{h(p=>({...p,customBadges:p.customBadges.map((y,x)=>x===c?d:y)})),R(null)},Me=async c=>{var ae,le;if(c.preventDefault(),i.displayName.trim().length===0){k("Enter the name you want other attendees to see."),(ae=b.current)==null||ae.focus();return}k(null);let d;const p=j=>j.filter(U=>typeof U=="string"&&U.trim().length>0),y=p(i.customBadges),x=p(P.current),H=JSON.stringify(y)!==JSON.stringify(x);if(t.customBadges===!0){const j=$.validateCustomBadges(y,{blockList:s==null?void 0:s.customBadgeBlockList});if(j.rejected.length>0){let U=0,J=[];for(let X=0;X<i.customBadges.length;X+=1){const ce=i.customBadges[X];if(ce.trim()&&(J=[...J,ce],$.validateCustomBadges(J,{blockList:s==null?void 0:s.customBadgeBlockList}).rejected.length>0)){U=X;break}}R({index:U,message:"Choose another custom badge. Use 24 characters or fewer, use only letters, numbers, spaces, apostrophes, hyphens, or periods, and do not use a blocked or repeated badge."}),(le=C.current[U])==null||le.focus();return}d=j.valid}R(null),E(!0);try{await a({displayName:i.displayName.trim(),pronouns:i.pronouns.trim(),jobTitle:i.jobTitle.trim(),organization:i.organization.trim(),bio:i.bio.trim(),profileVisibility:i.profileVisibility,badges:i.badges,...t.customBadges===!0&&H?{customBadges:d}:{},photoPath:i.photoPath?i.photoPath:null}),t.customBadges===!0&&H&&(P.current=d);const j=T.current,U=i.photoPath?i.photoPath:null;T.current=U,j&&j!==U&&await vn(j),u("Profile saved.")}catch{u("Your profile could not be saved. Try again.",{tone:"error"})}finally{E(!1)}};return l.jsxs("article",{className:"mx-auto max-w-2xl",children:[l.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:o?"Complete your profile":"Your profile"}),l.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),l.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:Me,noValidate:!0,children:[l.jsx(On,{uid:e.uid,value:i.photoPath,onChange:c=>B("photoPath",c)}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),l.jsx("input",{id:"displayName",ref:b,className:`mt-2xs ${V}`,value:i.displayName,onChange:c=>B("displayName",c.target.value),"aria-invalid":w?"true":void 0,"aria-describedby":w?"displayName-error":void 0,autoComplete:"name"}),w?l.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:w}):null]}),l.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[l.jsxs("div",{children:[l.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),l.jsx("input",{id:"pronouns",className:`mt-2xs ${V}`,value:i.pronouns,onChange:c=>B("pronouns",c.target.value)})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),l.jsx("input",{id:"jobTitle",className:`mt-2xs ${V}`,value:i.jobTitle,onChange:c=>B("jobTitle",c.target.value),autoComplete:"organization-title"})]})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),l.jsx("input",{id:"organization",className:`mt-2xs ${V}`,value:i.organization,onChange:c=>B("organization",c.target.value),autoComplete:"organization"})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),l.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${V}`,value:i.bio,onChange:c=>B("bio",c.target.value)})]}),l.jsxs("fieldset",{children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),l.jsx("div",{className:"mt-xs space-y-xs",children:M.map(c=>l.jsx(ut,{name:"profileVisibility",value:c,label:ye[c].label,description:ye[c].description,checked:i.profileVisibility===c,onChange:()=>B("profileVisibility",c)},c))})]}),D.length>0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(pe,{level:2,title:"Badges"}),Z?l.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",$.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,D.map(c=>{const d=c.badges.filter(y=>i.badges.includes(y.id)).length,p=c.maxPicks!=null&&d>=c.maxPicks;return l.jsxs("fieldset",{className:"mt-md",children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:c.label}),c.maxPicks!=null?l.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:p?`You’ve picked all ${c.maxPicks} — clear one to choose another.`:`Pick up to ${c.maxPicks} (${d} chosen).`}):null,l.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:c.badges.map(y=>{const x=i.badges.includes(y.id);return l.jsx(dt,{label:y.label,checked:x,disabled:!x&&p,className:!x&&p?"text-text-secondary":"",onChange:()=>Le(y.id)},y.id)})})]},c.id)})]}):null,t.customBadges===!0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(pe,{level:2,title:"Custom badges"}),l.jsx("div",{className:"mt-md grid gap-md sm:grid-cols-3",children:i.customBadges.map((c,d)=>{const p=(_==null?void 0:_.index)===d?_.message:null;return l.jsxs("div",{children:[l.jsxs("label",{htmlFor:`customBadge-${d}`,className:"block font-semibold text-text-primary",children:["Custom badge ",d+1]}),l.jsx("input",{id:`customBadge-${d}`,ref:y=>{C.current[d]=y},className:`mt-2xs ${V}`,value:c,maxLength:$.MAX_CUSTOM_BADGE_LENGTH,onChange:y=>Fe(d,y.target.value),"aria-invalid":p?"true":void 0,"aria-describedby":p?`customBadge-${d}-error`:void 0}),p?l.jsx("p",{id:`customBadge-${d}-error`,role:"alert",className:"mt-2xs font-data text-caption text-danger",children:p}):null]},d)})})]}):null,l.jsx("button",{type:"submit",className:he,disabled:f,children:f?"Saving…":"Save profile"})]})]})}export{Dn as default};
