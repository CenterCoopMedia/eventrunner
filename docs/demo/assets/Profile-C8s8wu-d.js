import{aQ as G,aR as Se,aS as De,aT as Le,aU as Fe,aV as Me,aW as be,aX as $e,aY as Ve,aZ as He,a_ as ze,a$ as ae,b0 as qe,v as _e,b1 as Y,b2 as te,b3 as Xe,r as v,aN as We,j as l,A as Ye,q as Ge,p as Ke,a as Ze,u as Je,ax as Qe,g as et,b4 as L,ag as le,L as tt,ah as ce,b5 as nt,an as F,at as ue}from"./index-Bl17TI64.js";import{P as st,D as rt}from"./DefaultAvatarPicker-pC6VeXwD.js";import{R as ot,C as it}from"./Choice-BInQRKlK.js";/**
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
 */const xe="firebasestorage.googleapis.com",ye="storageBucket",at=2*60*1e3,lt=10*60*1e3;/**
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
 */class g extends Me{constructor(t,n,s=0){super(J(t),`Firebase Storage: ${n} (${J(t)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,g.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return J(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var m;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(m||(m={}));function J(e){return"storage/"+e}function se(){const e="An unknown error occurred, please check the error payload for server response.";return new g(m.UNKNOWN,e)}function ct(e){return new g(m.OBJECT_NOT_FOUND,"Object '"+e+"' does not exist.")}function ut(e){return new g(m.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function dt(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new g(m.UNAUTHENTICATED,e)}function ht(){return new g(m.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function pt(e){return new g(m.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function ft(){return new g(m.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function mt(){return new g(m.CANCELED,"User canceled the upload/download.")}function gt(e){return new g(m.INVALID_URL,"Invalid URL '"+e+"'.")}function bt(e){return new g(m.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function _t(){return new g(m.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+ye+"' property when initializing the app?")}function xt(){return new g(m.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function yt(e){return new g(m.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function ne(e){return new g(m.INVALID_ARGUMENT,e)}function Te(){return new g(m.APP_DELETED,"The Firebase app was deleted.")}function Tt(e){return new g(m.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function z(e,t){return new g(m.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function H(e){throw new g(m.INTERNAL_ERROR,"Internal error: "+e)}/**
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
 */class A{constructor(t,n){this.bucket=t,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,n){let s;try{s=A.makeFromUrl(t,n)}catch{return new A(t,"")}if(s.path==="")return s;throw bt(t)}static makeFromUrl(t,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function o(y){y.path.charAt(y.path.length-1)==="/"&&(y.path_=y.path_.slice(0,-1))}const a="(/(.*))?$",u=new RegExp("^gs://"+r+a,"i"),i={bucket:1,path:3};function d(y){y.path_=decodeURIComponent(y.path)}const p="v[A-Za-z0-9_]+",N=n.replace(/[.]/g,"\\."),T="(/([^?#]*).*)?$",R=new RegExp(`^https?://${N}/${p}/b/${r}/o${T}`,"i"),_={bucket:1,path:3},x=n===xe?"(?:storage.googleapis.com|storage.cloud.google.com)":n,b="([^?#]*)",E=new RegExp(`^https?://${x}/${r}/${b}`,"i"),P=[{regex:u,indices:i,postModify:o},{regex:R,indices:_,postModify:d},{regex:E,indices:{bucket:1,path:2},postModify:d}];for(let y=0;y<P.length;y++){const D=P[y],C=D.regex.exec(t);if(C){const K=C[D.indices.bucket];let M=C[D.indices.path];M||(M=""),s=new A(K,M),D.postModify(s);break}}if(s==null)throw gt(t);return s}}class Rt{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
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
 */function wt(e,t,n){let s=1,r=null,o=null,a=!1,u=0;function i(){return u===2}let d=!1;function p(...b){d||(d=!0,t.apply(null,b))}function N(b){r=setTimeout(()=>{r=null,e(R,i())},b)}function T(){o&&clearTimeout(o)}function R(b,...E){if(d){T();return}if(b){T(),p.call(null,b,...E);return}if(i()||a){T(),p.call(null,b,...E);return}s<64&&(s*=2);let P;u===1?(u=2,P=0):P=(s+Math.random())*1e3,N(P)}let _=!1;function x(b){_||(_=!0,T(),!d&&(r!==null?(b||(u=2),clearTimeout(r),N(0)):b||(u=1)))}return N(0),o=setTimeout(()=>{a=!0,x(!0)},n),x}function kt(e){e(!1)}/**
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
 */function Nt(e){return e!==void 0}function At(e){return typeof e=="object"&&!Array.isArray(e)}function Re(e){return typeof e=="string"||e instanceof String}function de(e){return re()&&e instanceof Blob}function re(){return typeof Blob<"u"}function he(e,t,n,s){if(s<t)throw ne(`Invalid value for '${e}'. Expected ${t} or greater.`);if(s>n)throw ne(`Invalid value for '${e}'. Expected ${n} or less.`)}/**
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
 */function we(e,t,n){let s=t;return n==null&&(s=`https://${t}`),`${n}://${s}/v0${e}`}function Et(e){const t=encodeURIComponent;let n="?";for(const s in e)if(e.hasOwnProperty(s)){const r=t(s)+"="+t(e[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var B;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})(B||(B={}));/**
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
 */function Pt(e,t){const n=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,o=t.indexOf(e)!==-1;return n||r||o}/**
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
 */class vt{constructor(t,n,s,r,o,a,u,i,d,p,N,T=!0,R=!1){this.url_=t,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=o,this.additionalRetryCodes_=a,this.callback_=u,this.errorCallback_=i,this.timeout_=d,this.progressCallback_=p,this.connectionFactory_=N,this.retry=T,this.isUsingEmulator=R,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((_,x)=>{this.resolve_=_,this.reject_=x,this.start_()})}start_(){const t=(s,r)=>{if(r){s(!1,new X(!1,null,!0));return}const o=this.connectionFactory_();this.pendingConnection_=o;const a=u=>{const i=u.loaded,d=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(i,d)};this.progressCallback_!==null&&o.addUploadProgressListener(a),o.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&o.removeUploadProgressListener(a),this.pendingConnection_=null;const u=o.getErrorCode()===B.NO_ERROR,i=o.getStatus();if(!u||Pt(i,this.additionalRetryCodes_)&&this.retry){const p=o.getErrorCode()===B.ABORT;s(!1,new X(!1,null,p));return}const d=this.successCodes_.indexOf(i)!==-1;s(!0,new X(d,o))})},n=(s,r)=>{const o=this.resolve_,a=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const i=this.callback_(u,u.getResponse());Nt(i)?o(i):o()}catch(i){a(i)}else if(u!==null){const i=se();i.serverResponse=u.getErrorText(),this.errorCallback_?a(this.errorCallback_(u,i)):a(i)}else if(r.canceled){const i=this.appDelete_?Te():mt();a(i)}else{const i=ft();a(i)}};this.canceled_?n(!1,new X(!1,null,!0)):this.backoffId_=wt(t,n,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&kt(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class X{constructor(t,n,s){this.wasSuccessCode=t,this.connection=n,this.canceled=!!s}}function Ot(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function Ct(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function It(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Ut(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function jt(e,t,n,s,r,o,a=!0,u=!1){const i=Et(e.urlParams),d=e.url+i,p=Object.assign({},e.headers);return It(p,t),Ot(p,n),Ct(p,o),Ut(p,s),new vt(d,e.method,p,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,a,u)}/**
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
 */function Bt(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function St(...e){const t=Bt();if(t!==void 0){const n=new t;for(let s=0;s<e.length;s++)n.append(e[s]);return n.getBlob()}else{if(re())return new Blob(e);throw new g(m.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Dt(e,t,n){return e.webkitSlice?e.webkitSlice(t,n):e.mozSlice?e.mozSlice(t,n):e.slice?e.slice(t,n):null}/**
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
 */const U={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class Q{constructor(t,n){this.data=t,this.contentType=n||null}}function Ft(e,t){switch(e){case U.RAW:return new Q(ke(t));case U.BASE64:case U.BASE64URL:return new Q(Ne(e,t));case U.DATA_URL:return new Q($t(t),Vt(t))}throw se()}function ke(e){const t=[];for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);if(s<=127)t.push(s);else if(s<=2047)t.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<e.length-1&&(e.charCodeAt(n+1)&64512)===56320))t.push(239,191,189);else{const o=s,a=e.charCodeAt(++n);s=65536|(o&1023)<<10|a&1023,t.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?t.push(239,191,189):t.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(t)}function Mt(e){let t;try{t=decodeURIComponent(e)}catch{throw z(U.DATA_URL,"Malformed data URL.")}return ke(t)}function Ne(e,t){switch(e){case U.BASE64:{const r=t.indexOf("-")!==-1,o=t.indexOf("_")!==-1;if(r||o)throw z(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case U.BASE64URL:{const r=t.indexOf("+")!==-1,o=t.indexOf("/")!==-1;if(r||o)throw z(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=Lt(t)}catch(r){throw r.message.includes("polyfill")?r:z(e,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class Ae{constructor(t){this.base64=!1,this.contentType=null;const n=t.match(/^data:([^,]+)?,/);if(n===null)throw z(U.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=Ht(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=t.substring(t.indexOf(",")+1)}}function $t(e){const t=new Ae(e);return t.base64?Ne(U.BASE64,t.rest):Mt(t.rest)}function Vt(e){return new Ae(e).contentType}function Ht(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
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
 */class j{constructor(t,n){let s=0,r="";de(t)?(this.data_=t,s=t.size,r=t.type):t instanceof ArrayBuffer?(n?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),s=this.data_.length):t instanceof Uint8Array&&(n?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),s=t.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,n){if(de(this.data_)){const s=this.data_,r=Dt(s,t,n);return r===null?null:new j(r)}else{const s=new Uint8Array(this.data_.buffer,t,n-t);return new j(s,!0)}}static getBlob(...t){if(re()){const n=t.map(s=>s instanceof j?s.data_:s);return new j(St.apply(null,n))}else{const n=t.map(a=>Re(a)?Ft(U.RAW,a).data:a.data_);let s=0;n.forEach(a=>{s+=a.byteLength});const r=new Uint8Array(s);let o=0;return n.forEach(a=>{for(let u=0;u<a.length;u++)r[o++]=a[u]}),new j(r,!0)}}uploadData(){return this.data_}}/**
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
 */function zt(e){let t;try{t=JSON.parse(e)}catch{return null}return At(t)?t:null}/**
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
 */function qt(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function Xt(e,t){const n=t.split("/").filter(s=>s.length>0).join("/");return e.length===0?n:e+"/"+n}function Ee(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
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
 */function Wt(e,t){return t}class k{constructor(t,n,s,r){this.server=t,this.local=n||t,this.writable=!!s,this.xform=r||Wt}}let W=null;function Yt(e){return!Re(e)||e.length<2?e:Ee(e)}function Gt(){if(W)return W;const e=[];e.push(new k("bucket")),e.push(new k("generation")),e.push(new k("metageneration")),e.push(new k("name","fullPath",!0));function t(o,a){return Yt(a)}const n=new k("name");n.xform=t,e.push(n);function s(o,a){return a!==void 0?Number(a):a}const r=new k("size");return r.xform=s,e.push(r),e.push(new k("timeCreated")),e.push(new k("updated")),e.push(new k("md5Hash",null,!0)),e.push(new k("cacheControl",null,!0)),e.push(new k("contentDisposition",null,!0)),e.push(new k("contentEncoding",null,!0)),e.push(new k("contentLanguage",null,!0)),e.push(new k("contentType",null,!0)),e.push(new k("metadata","customMetadata",!0)),W=e,W}function Kt(e,t){function n(){const s=e.bucket,r=e.fullPath,o=new A(s,r);return t._makeStorageReference(o)}Object.defineProperty(e,"ref",{get:n})}function Zt(e,t,n){const s={};s.type="file";const r=n.length;for(let o=0;o<r;o++){const a=n[o];s[a.local]=a.xform(s,t[a.server])}return Kt(s,e),s}function Jt(e,t,n){const s=zt(t);return s===null?null:Zt(e,s,n)}function Qt(e,t){const n={},s=t.length;for(let r=0;r<s;r++){const o=t[r];o.writable&&(n[o.server]=e[o.local])}return JSON.stringify(n)}class Pe{constructor(t,n,s,r){this.url=t,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
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
 */function en(e){if(!e)throw se()}function tn(e,t){function n(s,r){const o=Jt(e,r,t);return en(o!==null),o}return n}function ve(e){function t(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=ht():r=dt():n.getStatus()===402?r=ut(e.bucket):n.getStatus()===403?r=pt(e.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return t}function nn(e){const t=ve(e);function n(s,r){let o=t(s,r);return s.getStatus()===404&&(o=ct(e.path)),o.serverResponse=r.serverResponse,o}return n}function sn(e,t){const n=t.fullServerUrl(),s=we(n,e.host,e._protocol),r="DELETE",o=e.maxOperationRetryTime;function a(i,d){}const u=new Pe(s,r,a,o);return u.successCodes=[200,204],u.errorHandler=nn(t),u}function rn(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function on(e,t,n){const s=Object.assign({},n);return s.fullPath=e.path,s.size=t.size(),s.contentType||(s.contentType=rn(null,t)),s}function an(e,t,n,s,r){const o=t.bucketOnlyServerUrl(),a={"X-Goog-Upload-Protocol":"multipart"};function u(){let P="";for(let y=0;y<2;y++)P=P+Math.random().toString().slice(2);return P}const i=u();a["Content-Type"]="multipart/related; boundary="+i;const d=on(t,s,r),p=Qt(d,n),N="--"+i+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+p+`\r
--`+i+`\r
Content-Type: `+d.contentType+`\r
\r
`,T=`\r
--`+i+"--",R=j.getBlob(N,s,T);if(R===null)throw xt();const _={name:d.fullPath},x=we(o,e.host,e._protocol),b="POST",E=e.maxUploadRetryTime,O=new Pe(x,b,tn(e,n),E);return O.urlParams=_,O.headers=a,O.body=R.uploadData(),O.errorHandler=ve(t),O}/**
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
 */class ln{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=B.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=B.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=B.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,n,s,r,o){if(this.sent_)throw H("cannot .send() more than once");if(be(t)&&s&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(n,t,!0),o!==void 0)for(const a in o)o.hasOwnProperty(a)&&this.xhr_.setRequestHeader(a,o[a].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw H("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw H("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw H("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw H("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class cn extends ln{initXhr(){this.xhr_.responseType="text"}}function Oe(){return new cn}/**
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
 */class S{constructor(t,n){this._service=t,n instanceof A?this._location=n:this._location=A.makeFromUrl(n,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,n){return new S(t,n)}get root(){const t=new A(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return Ee(this._location.path)}get storage(){return this._service}get parent(){const t=qt(this._location.path);if(t===null)return null;const n=new A(this._location.bucket,t);return new S(this._service,n)}_throwIfRoot(t){if(this._location.path==="")throw Tt(t)}}function un(e,t,n){e._throwIfRoot("uploadBytes");const s=an(e.storage,e._location,Gt(),new j(t,!0),n);return e.storage.makeRequestWithTokens(s,Oe).then(r=>({metadata:r,ref:e}))}function dn(e){e._throwIfRoot("deleteObject");const t=sn(e.storage,e._location);return e.storage.makeRequestWithTokens(t,Oe)}function hn(e,t){const n=Xt(e._location.path,t),s=new A(e._location.bucket,n);return new S(e.storage,s)}/**
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
 */function pn(e){return/^[A-Za-z]+:\/\//.test(e)}function fn(e,t){return new S(e,t)}function Ce(e,t){if(e instanceof oe){const n=e;if(n._bucket==null)throw _t();const s=new S(n,n._bucket);return t!=null?Ce(s,t):s}else return t!==void 0?hn(e,t):e}function mn(e,t){if(t&&pn(t)){if(e instanceof oe)return fn(e,t);throw ne("To use ref(service, url), the first argument must be a Storage instance.")}else return Ce(e,t)}function pe(e,t){const n=t==null?void 0:t[ye];return n==null?null:A.makeFromBucketSpec(n,e)}function gn(e,t,n,s={}){e.host=`${t}:${n}`;const r=be(t);r&&$e(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:o}=s;o&&(e._overrideAuthToken=typeof o=="string"?o:Ve(o,e.app.options.projectId))}class oe{constructor(t,n,s,r,o,a=!1){this.app=t,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=o,this._isUsingEmulator=a,this._bucket=null,this._host=xe,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=at,this._maxUploadRetryTime=lt,this._requests=new Set,r!=null?this._bucket=A.makeFromBucketSpec(r,this._host):this._bucket=pe(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=A.makeFromBucketSpec(this._url,t):this._bucket=pe(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){he("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){he("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const n=await t.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){if(Fe(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new S(this,t)}_makeRequest(t,n,s,r,o=!0){if(this._deleted)return new Rt(Te());{const a=jt(t,this._appId,s,r,n,this._firebaseVersion,o,this._isUsingEmulator);return this._requests.add(a),a.getPromise().then(()=>this._requests.delete(a),()=>this._requests.delete(a)),a}}async makeRequestWithTokens(t,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,n,s,r).getPromise()}}const fe="@firebase/storage",me="0.14.4";/**
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
 */const Ie="storage";function bn(e,t,n){return e=G(e),un(e,t,n)}function _n(e){return e=G(e),dn(e)}function Ue(e,t){return e=G(e),mn(e,t)}function xn(e=Le(),t){e=G(e);const s=Se(e,Ie).getImmediate({identifier:t}),r=De("storage");return r&&yn(s,...r),s}function yn(e,t,n,s={}){gn(e,t,n,s)}/**
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
 */function Tn(e,{instanceIdentifier:t}){const n=e.getProvider("app").getImmediate(),s=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new oe(n,s,r,t,qe)}function Rn(){He(new ze(Ie,Tn,"PUBLIC").setMultipleInstances(!0)),ae(fe,me,""),ae(fe,me,"esm2020")}Rn();let ee=null;function je(){return ee||(ee=xn(Xe)),ee}async function wn({uid:e,file:t}){const n=_e(t,{types:Y,maxBytes:te,exclusive:!0});if(n)throw new Error(n);const s=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=`profile-photos/${e}/photo.${s}`;return await bn(Ue(je(),r),t,{contentType:t.type}),{path:r}}async function kn(e){if(!(typeof e!="string"||!e.startsWith("profile-photos/")))try{await _n(Ue(je(),e))}catch{}}function Nn({uid:e,value:t,onChange:n}){const s=v.useRef(null),[r,o]=v.useState(null),[a,u]=v.useState(!1),[i,d]=v.useState(null);async function p(_){u(!0),o(null);try{const{path:x}=await wn({uid:e,file:_});n(x)}catch{o("Your photo could not be uploaded. Try again.")}finally{u(!1),d(null),s.current&&(s.current.value="")}}async function N(_){var E;const x=((E=_.target.files)==null?void 0:E[0])??null;if(!x)return;const b=_e(x,{types:Y,maxBytes:te,exclusive:!0});if(b){o(b),s.current&&(s.current.value="");return}s.current&&(s.current.value=""),d(x)}function T(){n("")}const R=We(t);return l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("span",{className:"block font-semibold text-brand-ink",children:"Photo"}),l.jsxs("div",{className:"flex items-center gap-4",children:[t&&!R?l.jsx(Ye,{path:t,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):R?l.jsx("img",{src:R,alt:"Your chosen default avatar",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):l.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-brand-ink/20 text-xs text-brand-ink-muted",children:"None"}),l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("label",{htmlFor:"profile-photo",className:"touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt",children:a?"Uploading…":t?"Replace photo":"Upload a photo"}),l.jsx("input",{id:"profile-photo",ref:s,type:"file",accept:Y.join(","),className:"sr-only",disabled:a,onChange:N,"aria-describedby":"profile-photo-hint"}),t?l.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-brand-ink-muted underline hover:bg-brand-surface-alt",onClick:T,disabled:a,children:"Remove photo"}):null]})]}),i?l.jsx(st,{file:i,label:"your profile photo",onApply:_=>p(_),onCancel:()=>d(null)}):null,l.jsx(rt,{value:t,onChange:n,namePrefix:"profile"}),l.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-brand-ink-muted",children:[Y.map(Ge).join(", ")," · up to"," ",Ke(te),". Save your profile to publish the change."]}),r?l.jsx("p",{role:"alert",className:"text-sm text-danger",children:r}):null]})}const ge={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function An(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id,maxPicks:Number.isInteger(n.maxPicks)&&n.maxPicks>0?n.maxPicks:null,badges:(Array.isArray(n.badges)?n.badges:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id}))})).filter(n=>n.badges.length>0)}const En=5;function Pn(e){return e.reduce((t,n)=>t+Math.min(n.maxPicks??n.badges.length,n.badges.length),0)}function In(){const{user:e}=Ze(),{features:t,badges:n}=Je(),{profile:s,status:r,needsProfileSetup:o,saveProfile:a}=Qe(),{showToast:u}=et(),[i,d]=v.useState(null),[p,N]=v.useState(!1),[T,R]=v.useState(null),[_,x]=v.useState(null),b=v.useRef(null),E=v.useRef([]),O=v.useRef(null);if(v.useEffect(()=>{i!=null||s==null||(d({displayName:s.displayName??"",pronouns:s.pronouns??"",jobTitle:s.jobTitle??"",organization:s.organization??"",bio:s.bio??"",profileVisibility:s.profileVisibility??"attendees_only",badges:Array.isArray(s.badges)?s.badges:[],customBadges:Array.from({length:L.MAX_CUSTOM_BADGES},(c,h)=>{var f;return typeof((f=s.customBadges)==null?void 0:f[h])=="string"?s.customBadges[h]:""}),photoPath:typeof s.photoPath=="string"?s.photoPath:""}),O.current=typeof s.photoPath=="string"?s.photoPath:null)},[s,i]),!e)return l.jsx(le,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:l.jsx(tt,{to:"/signin",className:ce,children:"Go to sign in"})});if(r==="pending-account"||i==null)return l.jsx(le,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const P=nt.PROFILE_VISIBILITIES.filter(c=>c!=="public"||t.publicAttendeeProfiles||i.profileVisibility==="public"),y=t.badges?An(n):[],D=L.MAX_TOTAL_BADGES-Pn(y)<=En,C=(c,h)=>d(f=>({...f,[c]:h})),K=c=>d(h=>({...h,badges:h.badges.includes(c)?h.badges.filter(f=>f!==c):[...h.badges,c]})),M=(c,h)=>{d(f=>({...f,customBadges:f.customBadges.map((w,I)=>I===c?h:w)})),x(null)},Be=async c=>{var f,w;if(c.preventDefault(),i.displayName.trim().length===0){R("Enter the name you want other attendees to see."),(f=b.current)==null||f.focus();return}R(null);let h;if(t.customBadges===!0){const I=i.customBadges.filter(V=>V.trim().length>0),$=L.validateCustomBadges(I,{blockList:n==null?void 0:n.customBadgeBlockList});if($.rejected.length>0){let V=0,Z=[];for(let q=0;q<i.customBadges.length;q+=1){const ie=i.customBadges[q];if(ie.trim()&&(Z=[...Z,ie],L.validateCustomBadges(Z,{blockList:n==null?void 0:n.customBadgeBlockList}).rejected.length>0)){V=q;break}}x({index:V,message:"Choose another custom badge. Use 24 characters or fewer, use only letters, numbers, spaces, apostrophes, hyphens, or periods, and do not use a blocked or repeated badge."}),(w=E.current[V])==null||w.focus();return}h=$.valid}x(null),N(!0);try{await a({displayName:i.displayName.trim(),pronouns:i.pronouns.trim(),jobTitle:i.jobTitle.trim(),organization:i.organization.trim(),bio:i.bio.trim(),profileVisibility:i.profileVisibility,badges:i.badges,...t.customBadges===!0?{customBadges:h}:{},photoPath:i.photoPath?i.photoPath:null});const I=O.current,$=i.photoPath?i.photoPath:null;O.current=$,I&&I!==$&&await kn(I),u("Profile saved.")}catch{u("Your profile could not be saved. Try again.",{tone:"error"})}finally{N(!1)}};return l.jsxs("article",{className:"mx-auto max-w-2xl",children:[l.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:o?"Complete your profile":"Your profile"}),l.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),l.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:Be,noValidate:!0,children:[l.jsx(Nn,{uid:e.uid,value:i.photoPath,onChange:c=>C("photoPath",c)}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),l.jsx("input",{id:"displayName",ref:b,className:`mt-2xs ${F}`,value:i.displayName,onChange:c=>C("displayName",c.target.value),"aria-invalid":T?"true":void 0,"aria-describedby":T?"displayName-error":void 0,autoComplete:"name"}),T?l.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:T}):null]}),l.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[l.jsxs("div",{children:[l.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),l.jsx("input",{id:"pronouns",className:`mt-2xs ${F}`,value:i.pronouns,onChange:c=>C("pronouns",c.target.value)})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),l.jsx("input",{id:"jobTitle",className:`mt-2xs ${F}`,value:i.jobTitle,onChange:c=>C("jobTitle",c.target.value),autoComplete:"organization-title"})]})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),l.jsx("input",{id:"organization",className:`mt-2xs ${F}`,value:i.organization,onChange:c=>C("organization",c.target.value),autoComplete:"organization"})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),l.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${F}`,value:i.bio,onChange:c=>C("bio",c.target.value)})]}),l.jsxs("fieldset",{children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),l.jsx("div",{className:"mt-xs space-y-xs",children:P.map(c=>l.jsx(ot,{name:"profileVisibility",value:c,label:ge[c].label,description:ge[c].description,checked:i.profileVisibility===c,onChange:()=>C("profileVisibility",c)},c))})]}),y.length>0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(ue,{level:2,title:"Badges"}),D?l.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",L.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,y.map(c=>{const h=c.badges.filter(w=>i.badges.includes(w.id)).length,f=c.maxPicks!=null&&h>=c.maxPicks;return l.jsxs("fieldset",{className:"mt-md",children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:c.label}),c.maxPicks!=null?l.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:f?`You’ve picked all ${c.maxPicks} — clear one to choose another.`:`Pick up to ${c.maxPicks} (${h} chosen).`}):null,l.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:c.badges.map(w=>{const I=i.badges.includes(w.id);return l.jsx(it,{label:w.label,checked:I,disabled:!I&&f,className:!I&&f?"text-text-secondary":"",onChange:()=>K(w.id)},w.id)})})]},c.id)})]}):null,t.customBadges===!0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(ue,{level:2,title:"Custom badges"}),l.jsx("div",{className:"mt-md grid gap-md sm:grid-cols-3",children:i.customBadges.map((c,h)=>{const f=(_==null?void 0:_.index)===h?_.message:null;return l.jsxs("div",{children:[l.jsxs("label",{htmlFor:`customBadge-${h}`,className:"block font-semibold text-text-primary",children:["Custom badge ",h+1]}),l.jsx("input",{id:`customBadge-${h}`,ref:w=>{E.current[h]=w},className:`mt-2xs ${F}`,value:c,maxLength:L.MAX_CUSTOM_BADGE_LENGTH,onChange:w=>M(h,w.target.value),"aria-invalid":f?"true":void 0,"aria-describedby":f?`customBadge-${h}-error`:void 0}),f?l.jsx("p",{id:`customBadge-${h}-error`,role:"alert",className:"mt-2xs font-data text-caption text-danger",children:f}):null]},h)})})]}):null,l.jsx("button",{type:"submit",className:ce,disabled:p,children:p?"Saving…":"Save profile"})]})]})}export{In as default};
