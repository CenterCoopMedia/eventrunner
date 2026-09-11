import{aQ as Z,aR as Me,aS as $e,aT as Ve,aU as He,aV as ze,aW as xe,aX as qe,aY as Xe,aZ as We,a_ as Ye,a$ as ce,b0 as Ge,v as ye,b1 as K,b2 as se,b3 as Ke,r as A,aN as Ze,j as l,A as Je,q as Qe,p as et,a as tt,u as nt,ax as st,g as rt,b4 as L,ag as ue,L as ot,ah as de,b5 as it,an as $,at as he}from"./index-BuAJA7nT.js";import{P as at,D as lt}from"./DefaultAvatarPicker-DpvdPAHM.js";import{R as ct,C as ut}from"./Choice-DQquvRke.js";/**
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
 */const Re="firebasestorage.googleapis.com",Te="storageBucket",dt=2*60*1e3,ht=10*60*1e3;/**
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
 */class g extends ze{constructor(t,n,s=0){super(ee(t),`Firebase Storage: ${n} (${ee(t)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,g.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return ee(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var m;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(m||(m={}));function ee(e){return"storage/"+e}function oe(){const e="An unknown error occurred, please check the error payload for server response.";return new g(m.UNKNOWN,e)}function pt(e){return new g(m.OBJECT_NOT_FOUND,"Object '"+e+"' does not exist.")}function ft(e){return new g(m.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function mt(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new g(m.UNAUTHENTICATED,e)}function gt(){return new g(m.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function bt(e){return new g(m.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function _t(){return new g(m.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function xt(){return new g(m.CANCELED,"User canceled the upload/download.")}function yt(e){return new g(m.INVALID_URL,"Invalid URL '"+e+"'.")}function Rt(e){return new g(m.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function Tt(){return new g(m.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+Te+"' property when initializing the app?")}function wt(){return new g(m.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function kt(e){return new g(m.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function re(e){return new g(m.INVALID_ARGUMENT,e)}function we(){return new g(m.APP_DELETED,"The Firebase app was deleted.")}function Nt(e){return new g(m.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function X(e,t){return new g(m.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function q(e){throw new g(m.INTERNAL_ERROR,"Internal error: "+e)}/**
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
 */class O{constructor(t,n){this.bucket=t,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,n){let s;try{s=O.makeFromUrl(t,n)}catch{return new O(t,"")}if(s.path==="")return s;throw Rt(t)}static makeFromUrl(t,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function o(T){T.path.charAt(T.path.length-1)==="/"&&(T.path_=T.path_.slice(0,-1))}const a="(/(.*))?$",u=new RegExp("^gs://"+r+a,"i"),i={bucket:1,path:3};function h(T){T.path_=decodeURIComponent(T.path)}const f="v[A-Za-z0-9_]+",E=n.replace(/[.]/g,"\\."),w="(/([^?#]*).*)?$",k=new RegExp(`^https?://${E}/${f}/b/${r}/o${w}`,"i"),x={bucket:1,path:3},R=n===Re?"(?:storage.googleapis.com|storage.cloud.google.com)":n,b="([^?#]*)",C=new RegExp(`^https?://${R}/${r}/${b}`,"i"),P=[{regex:u,indices:i,postModify:o},{regex:k,indices:x,postModify:h},{regex:C,indices:{bucket:1,path:2},postModify:h}];for(let T=0;T<P.length;T++){const M=P[T],j=M.regex.exec(t);if(j){const J=j[M.indices.bucket];let B=j[M.indices.path];B||(B=""),s=new O(J,B),M.postModify(s);break}}if(s==null)throw yt(t);return s}}class At{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
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
 */function Et(e,t,n){let s=1,r=null,o=null,a=!1,u=0;function i(){return u===2}let h=!1;function f(...b){h||(h=!0,t.apply(null,b))}function E(b){r=setTimeout(()=>{r=null,e(k,i())},b)}function w(){o&&clearTimeout(o)}function k(b,...C){if(h){w();return}if(b){w(),f.call(null,b,...C);return}if(i()||a){w(),f.call(null,b,...C);return}s<64&&(s*=2);let P;u===1?(u=2,P=0):P=(s+Math.random())*1e3,E(P)}let x=!1;function R(b){x||(x=!0,w(),!h&&(r!==null?(b||(u=2),clearTimeout(r),E(0)):b||(u=1)))}return E(0),o=setTimeout(()=>{a=!0,R(!0)},n),R}function vt(e){e(!1)}/**
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
 */function Pt(e){return e!==void 0}function Ot(e){return typeof e=="object"&&!Array.isArray(e)}function ke(e){return typeof e=="string"||e instanceof String}function pe(e){return ie()&&e instanceof Blob}function ie(){return typeof Blob<"u"}function fe(e,t,n,s){if(s<t)throw re(`Invalid value for '${e}'. Expected ${t} or greater.`);if(s>n)throw re(`Invalid value for '${e}'. Expected ${n} or less.`)}/**
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
 */function Ne(e,t,n){let s=t;return n==null&&(s=`https://${t}`),`${n}://${s}/v0${e}`}function Ct(e){const t=encodeURIComponent;let n="?";for(const s in e)if(e.hasOwnProperty(s)){const r=t(s)+"="+t(e[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var D;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})(D||(D={}));/**
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
 */function Bt(e,t){const n=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,o=t.indexOf(e)!==-1;return n||r||o}/**
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
 */class It{constructor(t,n,s,r,o,a,u,i,h,f,E,w=!0,k=!1){this.url_=t,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=o,this.additionalRetryCodes_=a,this.callback_=u,this.errorCallback_=i,this.timeout_=h,this.progressCallback_=f,this.connectionFactory_=E,this.retry=w,this.isUsingEmulator=k,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((x,R)=>{this.resolve_=x,this.reject_=R,this.start_()})}start_(){const t=(s,r)=>{if(r){s(!1,new Y(!1,null,!0));return}const o=this.connectionFactory_();this.pendingConnection_=o;const a=u=>{const i=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(i,h)};this.progressCallback_!==null&&o.addUploadProgressListener(a),o.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&o.removeUploadProgressListener(a),this.pendingConnection_=null;const u=o.getErrorCode()===D.NO_ERROR,i=o.getStatus();if(!u||Bt(i,this.additionalRetryCodes_)&&this.retry){const f=o.getErrorCode()===D.ABORT;s(!1,new Y(!1,null,f));return}const h=this.successCodes_.indexOf(i)!==-1;s(!0,new Y(h,o))})},n=(s,r)=>{const o=this.resolve_,a=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const i=this.callback_(u,u.getResponse());Pt(i)?o(i):o()}catch(i){a(i)}else if(u!==null){const i=oe();i.serverResponse=u.getErrorText(),this.errorCallback_?a(this.errorCallback_(u,i)):a(i)}else if(r.canceled){const i=this.appDelete_?we():xt();a(i)}else{const i=_t();a(i)}};this.canceled_?n(!1,new Y(!1,null,!0)):this.backoffId_=Et(t,n,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&vt(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class Y{constructor(t,n,s){this.wasSuccessCode=t,this.connection=n,this.canceled=!!s}}function Ut(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function jt(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function St(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Lt(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function Dt(e,t,n,s,r,o,a=!0,u=!1){const i=Ct(e.urlParams),h=e.url+i,f=Object.assign({},e.headers);return St(f,t),Ut(f,n),jt(f,o),Lt(f,s),new It(h,e.method,f,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,a,u)}/**
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
 */function Ft(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function Mt(...e){const t=Ft();if(t!==void 0){const n=new t;for(let s=0;s<e.length;s++)n.append(e[s]);return n.getBlob()}else{if(ie())return new Blob(e);throw new g(m.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function $t(e,t,n){return e.webkitSlice?e.webkitSlice(t,n):e.mozSlice?e.mozSlice(t,n):e.slice?e.slice(t,n):null}/**
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
 */function Vt(e){if(typeof atob>"u")throw kt("base-64");return atob(e)}/**
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
 */const I={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class te{constructor(t,n){this.data=t,this.contentType=n||null}}function Ht(e,t){switch(e){case I.RAW:return new te(Ae(t));case I.BASE64:case I.BASE64URL:return new te(Ee(e,t));case I.DATA_URL:return new te(qt(t),Xt(t))}throw oe()}function Ae(e){const t=[];for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);if(s<=127)t.push(s);else if(s<=2047)t.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<e.length-1&&(e.charCodeAt(n+1)&64512)===56320))t.push(239,191,189);else{const o=s,a=e.charCodeAt(++n);s=65536|(o&1023)<<10|a&1023,t.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?t.push(239,191,189):t.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(t)}function zt(e){let t;try{t=decodeURIComponent(e)}catch{throw X(I.DATA_URL,"Malformed data URL.")}return Ae(t)}function Ee(e,t){switch(e){case I.BASE64:{const r=t.indexOf("-")!==-1,o=t.indexOf("_")!==-1;if(r||o)throw X(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case I.BASE64URL:{const r=t.indexOf("+")!==-1,o=t.indexOf("/")!==-1;if(r||o)throw X(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=Vt(t)}catch(r){throw r.message.includes("polyfill")?r:X(e,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class ve{constructor(t){this.base64=!1,this.contentType=null;const n=t.match(/^data:([^,]+)?,/);if(n===null)throw X(I.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=Wt(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=t.substring(t.indexOf(",")+1)}}function qt(e){const t=new ve(e);return t.base64?Ee(I.BASE64,t.rest):zt(t.rest)}function Xt(e){return new ve(e).contentType}function Wt(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
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
 */class U{constructor(t,n){let s=0,r="";pe(t)?(this.data_=t,s=t.size,r=t.type):t instanceof ArrayBuffer?(n?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),s=this.data_.length):t instanceof Uint8Array&&(n?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),s=t.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,n){if(pe(this.data_)){const s=this.data_,r=$t(s,t,n);return r===null?null:new U(r)}else{const s=new Uint8Array(this.data_.buffer,t,n-t);return new U(s,!0)}}static getBlob(...t){if(ie()){const n=t.map(s=>s instanceof U?s.data_:s);return new U(Mt.apply(null,n))}else{const n=t.map(a=>ke(a)?Ht(I.RAW,a).data:a.data_);let s=0;n.forEach(a=>{s+=a.byteLength});const r=new Uint8Array(s);let o=0;return n.forEach(a=>{for(let u=0;u<a.length;u++)r[o++]=a[u]}),new U(r,!0)}}uploadData(){return this.data_}}/**
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
 */function Yt(e){let t;try{t=JSON.parse(e)}catch{return null}return Ot(t)?t:null}/**
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
 */function Gt(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function Kt(e,t){const n=t.split("/").filter(s=>s.length>0).join("/");return e.length===0?n:e+"/"+n}function Pe(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
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
 */function Zt(e,t){return t}class N{constructor(t,n,s,r){this.server=t,this.local=n||t,this.writable=!!s,this.xform=r||Zt}}let G=null;function Jt(e){return!ke(e)||e.length<2?e:Pe(e)}function Qt(){if(G)return G;const e=[];e.push(new N("bucket")),e.push(new N("generation")),e.push(new N("metageneration")),e.push(new N("name","fullPath",!0));function t(o,a){return Jt(a)}const n=new N("name");n.xform=t,e.push(n);function s(o,a){return a!==void 0?Number(a):a}const r=new N("size");return r.xform=s,e.push(r),e.push(new N("timeCreated")),e.push(new N("updated")),e.push(new N("md5Hash",null,!0)),e.push(new N("cacheControl",null,!0)),e.push(new N("contentDisposition",null,!0)),e.push(new N("contentEncoding",null,!0)),e.push(new N("contentLanguage",null,!0)),e.push(new N("contentType",null,!0)),e.push(new N("metadata","customMetadata",!0)),G=e,G}function en(e,t){function n(){const s=e.bucket,r=e.fullPath,o=new O(s,r);return t._makeStorageReference(o)}Object.defineProperty(e,"ref",{get:n})}function tn(e,t,n){const s={};s.type="file";const r=n.length;for(let o=0;o<r;o++){const a=n[o];s[a.local]=a.xform(s,t[a.server])}return en(s,e),s}function nn(e,t,n){const s=Yt(t);return s===null?null:tn(e,s,n)}function sn(e,t){const n={},s=t.length;for(let r=0;r<s;r++){const o=t[r];o.writable&&(n[o.server]=e[o.local])}return JSON.stringify(n)}class Oe{constructor(t,n,s,r){this.url=t,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
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
 */function rn(e){if(!e)throw oe()}function on(e,t){function n(s,r){const o=nn(e,r,t);return rn(o!==null),o}return n}function Ce(e){function t(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=gt():r=mt():n.getStatus()===402?r=ft(e.bucket):n.getStatus()===403?r=bt(e.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return t}function an(e){const t=Ce(e);function n(s,r){let o=t(s,r);return s.getStatus()===404&&(o=pt(e.path)),o.serverResponse=r.serverResponse,o}return n}function ln(e,t){const n=t.fullServerUrl(),s=Ne(n,e.host,e._protocol),r="DELETE",o=e.maxOperationRetryTime;function a(i,h){}const u=new Oe(s,r,a,o);return u.successCodes=[200,204],u.errorHandler=an(t),u}function cn(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function un(e,t,n){const s=Object.assign({},n);return s.fullPath=e.path,s.size=t.size(),s.contentType||(s.contentType=cn(null,t)),s}function dn(e,t,n,s,r){const o=t.bucketOnlyServerUrl(),a={"X-Goog-Upload-Protocol":"multipart"};function u(){let P="";for(let T=0;T<2;T++)P=P+Math.random().toString().slice(2);return P}const i=u();a["Content-Type"]="multipart/related; boundary="+i;const h=un(t,s,r),f=sn(h,n),E="--"+i+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+f+`\r
--`+i+`\r
Content-Type: `+h.contentType+`\r
\r
`,w=`\r
--`+i+"--",k=U.getBlob(E,s,w);if(k===null)throw wt();const x={name:h.fullPath},R=Ne(o,e.host,e._protocol),b="POST",C=e.maxUploadRetryTime,v=new Oe(R,b,on(e,n),C);return v.urlParams=x,v.headers=a,v.body=k.uploadData(),v.errorHandler=Ce(t),v}/**
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
 */class hn{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=D.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=D.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=D.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,n,s,r,o){if(this.sent_)throw q("cannot .send() more than once");if(xe(t)&&s&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(n,t,!0),o!==void 0)for(const a in o)o.hasOwnProperty(a)&&this.xhr_.setRequestHeader(a,o[a].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw q("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw q("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw q("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw q("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class pn extends hn{initXhr(){this.xhr_.responseType="text"}}function Be(){return new pn}/**
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
 */class F{constructor(t,n){this._service=t,n instanceof O?this._location=n:this._location=O.makeFromUrl(n,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,n){return new F(t,n)}get root(){const t=new O(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return Pe(this._location.path)}get storage(){return this._service}get parent(){const t=Gt(this._location.path);if(t===null)return null;const n=new O(this._location.bucket,t);return new F(this._service,n)}_throwIfRoot(t){if(this._location.path==="")throw Nt(t)}}function fn(e,t,n){e._throwIfRoot("uploadBytes");const s=dn(e.storage,e._location,Qt(),new U(t,!0),n);return e.storage.makeRequestWithTokens(s,Be).then(r=>({metadata:r,ref:e}))}function mn(e){e._throwIfRoot("deleteObject");const t=ln(e.storage,e._location);return e.storage.makeRequestWithTokens(t,Be)}function gn(e,t){const n=Kt(e._location.path,t),s=new O(e._location.bucket,n);return new F(e.storage,s)}/**
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
 */function bn(e){return/^[A-Za-z]+:\/\//.test(e)}function _n(e,t){return new F(e,t)}function Ie(e,t){if(e instanceof ae){const n=e;if(n._bucket==null)throw Tt();const s=new F(n,n._bucket);return t!=null?Ie(s,t):s}else return t!==void 0?gn(e,t):e}function xn(e,t){if(t&&bn(t)){if(e instanceof ae)return _n(e,t);throw re("To use ref(service, url), the first argument must be a Storage instance.")}else return Ie(e,t)}function me(e,t){const n=t==null?void 0:t[Te];return n==null?null:O.makeFromBucketSpec(n,e)}function yn(e,t,n,s={}){e.host=`${t}:${n}`;const r=xe(t);r&&qe(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:o}=s;o&&(e._overrideAuthToken=typeof o=="string"?o:Xe(o,e.app.options.projectId))}class ae{constructor(t,n,s,r,o,a=!1){this.app=t,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=o,this._isUsingEmulator=a,this._bucket=null,this._host=Re,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=dt,this._maxUploadRetryTime=ht,this._requests=new Set,r!=null?this._bucket=O.makeFromBucketSpec(r,this._host):this._bucket=me(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=O.makeFromBucketSpec(this._url,t):this._bucket=me(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){fe("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){fe("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const n=await t.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){if(He(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new F(this,t)}_makeRequest(t,n,s,r,o=!0){if(this._deleted)return new At(we());{const a=Dt(t,this._appId,s,r,n,this._firebaseVersion,o,this._isUsingEmulator);return this._requests.add(a),a.getPromise().then(()=>this._requests.delete(a),()=>this._requests.delete(a)),a}}async makeRequestWithTokens(t,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,n,s,r).getPromise()}}const ge="@firebase/storage",be="0.14.4";/**
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
 */const Ue="storage";function Rn(e,t,n){return e=Z(e),fn(e,t,n)}function Tn(e){return e=Z(e),mn(e)}function je(e,t){return e=Z(e),xn(e,t)}function wn(e=Ve(),t){e=Z(e);const s=Me(e,Ue).getImmediate({identifier:t}),r=$e("storage");return r&&kn(s,...r),s}function kn(e,t,n,s={}){yn(e,t,n,s)}/**
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
 */function Nn(e,{instanceIdentifier:t}){const n=e.getProvider("app").getImmediate(),s=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new ae(n,s,r,t,Ge)}function An(){We(new Ye(Ue,Nn,"PUBLIC").setMultipleInstances(!0)),ce(ge,be,""),ce(ge,be,"esm2020")}An();let ne=null;function Se(){return ne||(ne=wn(Ke)),ne}async function En({uid:e,file:t}){const n=ye(t,{types:K,maxBytes:se,exclusive:!0});if(n)throw new Error(n);const s=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=`profile-photos/${e}/photo.${s}`;return await Rn(je(Se(),r),t,{contentType:t.type}),{path:r}}async function vn(e){if(!(typeof e!="string"||!e.startsWith("profile-photos/")))try{await Tn(je(Se(),e))}catch{}}function Pn({uid:e,value:t,onChange:n}){const s=A.useRef(null),[r,o]=A.useState(null),[a,u]=A.useState(!1),[i,h]=A.useState(null);async function f(x){u(!0),o(null);try{const{path:R}=await En({uid:e,file:x});n(R)}catch{o("Your photo could not be uploaded. Try again.")}finally{u(!1),h(null),s.current&&(s.current.value="")}}async function E(x){var C;const R=((C=x.target.files)==null?void 0:C[0])??null;if(!R)return;const b=ye(R,{types:K,maxBytes:se,exclusive:!0});if(b){o(b),s.current&&(s.current.value="");return}s.current&&(s.current.value=""),h(R)}function w(){n("")}const k=Ze(t);return l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("span",{className:"block font-semibold text-brand-ink",children:"Photo"}),l.jsxs("div",{className:"flex items-center gap-4",children:[t&&!k?l.jsx(Je,{path:t,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):k?l.jsx("img",{src:k,alt:"Your chosen default avatar",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):l.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-brand-ink/20 text-xs text-brand-ink-muted",children:"None"}),l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("label",{htmlFor:"profile-photo",className:"touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt",children:a?"Uploading…":t?"Replace photo":"Upload a photo"}),l.jsx("input",{id:"profile-photo",ref:s,type:"file",accept:K.join(","),className:"sr-only",disabled:a,onChange:E,"aria-describedby":"profile-photo-hint"}),t?l.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-brand-ink-muted underline hover:bg-brand-surface-alt",onClick:w,disabled:a,children:"Remove photo"}):null]})]}),i?l.jsx(at,{file:i,label:"your profile photo",onApply:x=>f(x),onCancel:()=>h(null)}):null,l.jsx(lt,{value:t,onChange:n,namePrefix:"profile"}),l.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-brand-ink-muted",children:[K.map(Qe).join(", ")," · up to"," ",et(se),". Save your profile to publish the change."]}),r?l.jsx("p",{role:"alert",className:"text-sm text-danger",children:r}):null]})}const _e={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function On(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id,maxPicks:Number.isInteger(n.maxPicks)&&n.maxPicks>0?n.maxPicks:null,badges:(Array.isArray(n.badges)?n.badges:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id}))})).filter(n=>n.badges.length>0)}const Cn=5;function Bn(e){return e.reduce((t,n)=>t+Math.min(n.maxPicks??n.badges.length,n.badges.length),0)}function Sn(){const{user:e}=tt(),{features:t,badges:n}=nt(),{profile:s,status:r,needsProfileSetup:o,saveProfile:a}=st(),{showToast:u}=rt(),[i,h]=A.useState(null),[f,E]=A.useState(!1),[w,k]=A.useState(null),[x,R]=A.useState(null),b=A.useRef(null),C=A.useRef([]),v=A.useRef([]),P=A.useRef([]),T=A.useRef(null);if(A.useEffect(()=>{i!=null||s==null||(v.current=Array.isArray(s.customBadges)?s.customBadges:[],P.current=v.current,h({displayName:s.displayName??"",pronouns:s.pronouns??"",jobTitle:s.jobTitle??"",organization:s.organization??"",bio:s.bio??"",profileVisibility:s.profileVisibility??"attendees_only",badges:Array.isArray(s.badges)?s.badges:[],customBadges:Array.from({length:L.MAX_CUSTOM_BADGES},(c,d)=>{var p;return typeof((p=s.customBadges)==null?void 0:p[d])=="string"?s.customBadges[d]:""}),photoPath:typeof s.photoPath=="string"?s.photoPath:""}),T.current=typeof s.photoPath=="string"?s.photoPath:null)},[s,i]),A.useEffect(()=>{if(!s)return;const c=_=>typeof _=="string"?_.trim().replace(/\s+/g," ").toLowerCase():"",d=Array.isArray(s.customBadges)?s.customBadges:[],p=new Set(d.map(c)),y=new Set(P.current.map(c).filter(_=>!p.has(_)));P.current=d,y.size&&(v.current=v.current.filter(_=>!y.has(c(_))),h(_=>_&&{..._,customBadges:_.customBadges.map(V=>y.has(c(V))?"":V)}))},[s]),!e)return l.jsx(ue,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:l.jsx(ot,{to:"/signin",className:de,children:"Go to sign in"})});if(r==="pending-account"||i==null)return l.jsx(ue,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const M=it.PROFILE_VISIBILITIES.filter(c=>c!=="public"||t.publicAttendeeProfiles||i.profileVisibility==="public"),j=t.badges?On(n):[],J=L.MAX_TOTAL_BADGES-Bn(j)<=Cn,B=(c,d)=>h(p=>({...p,[c]:d})),Le=c=>h(d=>({...d,badges:d.badges.includes(c)?d.badges.filter(p=>p!==c):[...d.badges,c]})),De=(c,d)=>{h(p=>({...p,customBadges:p.customBadges.map((y,_)=>_===c?d:y)})),R(null)},Fe=async c=>{var _,V;if(c.preventDefault(),i.displayName.trim().length===0){k("Enter the name you want other attendees to see."),(_=b.current)==null||_.focus();return}k(null);let d;const p=S=>L.validateCustomBadges(S,{blockList:n==null?void 0:n.customBadgeBlockList}).valid,y=JSON.stringify(p(i.customBadges))!==JSON.stringify(p(v.current));if(t.customBadges===!0){const S=i.customBadges.filter(z=>z.trim().length>0),H=L.validateCustomBadges(S,{blockList:n==null?void 0:n.customBadgeBlockList});if(H.rejected.length>0){let z=0,Q=[];for(let W=0;W<i.customBadges.length;W+=1){const le=i.customBadges[W];if(le.trim()&&(Q=[...Q,le],L.validateCustomBadges(Q,{blockList:n==null?void 0:n.customBadgeBlockList}).rejected.length>0)){z=W;break}}R({index:z,message:"Choose another custom badge. Use 24 characters or fewer, use only letters, numbers, spaces, apostrophes, hyphens, or periods, and do not use a blocked or repeated badge."}),(V=C.current[z])==null||V.focus();return}d=H.valid}R(null),E(!0);try{await a({displayName:i.displayName.trim(),pronouns:i.pronouns.trim(),jobTitle:i.jobTitle.trim(),organization:i.organization.trim(),bio:i.bio.trim(),profileVisibility:i.profileVisibility,badges:i.badges,...t.customBadges===!0&&y?{customBadges:d}:{},photoPath:i.photoPath?i.photoPath:null}),t.customBadges===!0&&y&&(v.current=d);const S=T.current,H=i.photoPath?i.photoPath:null;T.current=H,S&&S!==H&&await vn(S),u("Profile saved.")}catch{u("Your profile could not be saved. Try again.",{tone:"error"})}finally{E(!1)}};return l.jsxs("article",{className:"mx-auto max-w-2xl",children:[l.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:o?"Complete your profile":"Your profile"}),l.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),l.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:Fe,noValidate:!0,children:[l.jsx(Pn,{uid:e.uid,value:i.photoPath,onChange:c=>B("photoPath",c)}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),l.jsx("input",{id:"displayName",ref:b,className:`mt-2xs ${$}`,value:i.displayName,onChange:c=>B("displayName",c.target.value),"aria-invalid":w?"true":void 0,"aria-describedby":w?"displayName-error":void 0,autoComplete:"name"}),w?l.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:w}):null]}),l.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[l.jsxs("div",{children:[l.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),l.jsx("input",{id:"pronouns",className:`mt-2xs ${$}`,value:i.pronouns,onChange:c=>B("pronouns",c.target.value)})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),l.jsx("input",{id:"jobTitle",className:`mt-2xs ${$}`,value:i.jobTitle,onChange:c=>B("jobTitle",c.target.value),autoComplete:"organization-title"})]})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),l.jsx("input",{id:"organization",className:`mt-2xs ${$}`,value:i.organization,onChange:c=>B("organization",c.target.value),autoComplete:"organization"})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),l.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${$}`,value:i.bio,onChange:c=>B("bio",c.target.value)})]}),l.jsxs("fieldset",{children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),l.jsx("div",{className:"mt-xs space-y-xs",children:M.map(c=>l.jsx(ct,{name:"profileVisibility",value:c,label:_e[c].label,description:_e[c].description,checked:i.profileVisibility===c,onChange:()=>B("profileVisibility",c)},c))})]}),j.length>0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(he,{level:2,title:"Badges"}),J?l.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",L.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,j.map(c=>{const d=c.badges.filter(y=>i.badges.includes(y.id)).length,p=c.maxPicks!=null&&d>=c.maxPicks;return l.jsxs("fieldset",{className:"mt-md",children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:c.label}),c.maxPicks!=null?l.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:p?`You’ve picked all ${c.maxPicks} — clear one to choose another.`:`Pick up to ${c.maxPicks} (${d} chosen).`}):null,l.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:c.badges.map(y=>{const _=i.badges.includes(y.id);return l.jsx(ut,{label:y.label,checked:_,disabled:!_&&p,className:!_&&p?"text-text-secondary":"",onChange:()=>Le(y.id)},y.id)})})]},c.id)})]}):null,t.customBadges===!0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(he,{level:2,title:"Custom badges"}),l.jsx("div",{className:"mt-md grid gap-md sm:grid-cols-3",children:i.customBadges.map((c,d)=>{const p=(x==null?void 0:x.index)===d?x.message:null;return l.jsxs("div",{children:[l.jsxs("label",{htmlFor:`customBadge-${d}`,className:"block font-semibold text-text-primary",children:["Custom badge ",d+1]}),l.jsx("input",{id:`customBadge-${d}`,ref:y=>{C.current[d]=y},className:`mt-2xs ${$}`,value:c,maxLength:L.MAX_CUSTOM_BADGE_LENGTH,onChange:y=>De(d,y.target.value),"aria-invalid":p?"true":void 0,"aria-describedby":p?`customBadge-${d}-error`:void 0}),p?l.jsx("p",{id:`customBadge-${d}-error`,role:"alert",className:"mt-2xs font-data text-caption text-danger",children:p}):null]},d)})})]}):null,l.jsx("button",{type:"submit",className:de,disabled:f,children:f?"Saving…":"Save profile"})]})]})}export{Sn as default};
