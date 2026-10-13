import{aS as ne,aT as We,aU as Ge,aV as Ke,aW as Ze,aX as Je,aY as Pe,aZ as Qe,a_ as et,a$ as tt,b0 as nt,b1 as xe,b2 as st,F as Ue,b3 as te,b4 as ce,b5 as rt,r as m,aF as ot,j as c,B as it,E as at,C as lt,c as ct,b as ut,ad as dt,n as ht,b6 as z,X as Re,L as pt,Y as we,b7 as ft,a3 as Y,a9 as Te}from"./index-Di49h9xv.js";import{P as mt,D as gt}from"./DefaultAvatarPicker-CQZ5FX5g.js";import{R as bt,C as _t}from"./Choice-oCV1EShG.js";/**
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
 */const Ie="firebasestorage.googleapis.com",je="storageBucket",yt=2*60*1e3,xt=10*60*1e3;/**
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
 */class _ extends Je{constructor(t,s,n=0){super(oe(t),`Firebase Storage: ${s} (${oe(t)})`),this.status_=n,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,_.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return oe(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var b;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(b||(b={}));function oe(e){return"storage/"+e}function de(){const e="An unknown error occurred, please check the error payload for server response.";return new _(b.UNKNOWN,e)}function Rt(e){return new _(b.OBJECT_NOT_FOUND,"Object '"+e+"' does not exist.")}function wt(e){return new _(b.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function Tt(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new _(b.UNAUTHENTICATED,e)}function kt(){return new _(b.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function Nt(e){return new _(b.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function At(){return new _(b.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function Et(){return new _(b.CANCELED,"User canceled the upload/download.")}function vt(e){return new _(b.INVALID_URL,"Invalid URL '"+e+"'.")}function Ot(e){return new _(b.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function Pt(){return new _(b.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+je+"' property when initializing the app?")}function Ut(){return new _(b.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function It(e){return new _(b.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function ue(e){return new _(b.INVALID_ARGUMENT,e)}function Be(){return new _(b.APP_DELETED,"The Firebase app was deleted.")}function jt(e){return new _(b.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function G(e,t){return new _(b.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function W(e){throw new _(b.INTERNAL_ERROR,"Internal error: "+e)}/**
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
 */class B{constructor(t,s){this.bucket=t,this.path_=s}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,s){let n;try{n=B.makeFromUrl(t,s)}catch{return new B(t,"")}if(n.path==="")return n;throw Ot(t)}static makeFromUrl(t,s){let n=null;const r="([A-Za-z0-9.\\-_]+)";function o(w){w.path.charAt(w.path.length-1)==="/"&&(w.path_=w.path_.slice(0,-1))}const i="(/(.*))?$",u=new RegExp("^gs://"+r+i,"i"),a={bucket:1,path:3};function h(w){w.path_=decodeURIComponent(w.path)}const g="v[A-Za-z0-9_]+",v=s.replace(/[.]/g,"\\."),N="(/([^?#]*).*)?$",I=new RegExp(`^https?://${v}/${g}/b/${r}/o${N}`,"i"),E={bucket:1,path:3},x=s===Ie?"(?:storage.googleapis.com|storage.cloud.google.com)":s,y="([^?#]*)",O=new RegExp(`^https?://${x}/${r}/${y}`,"i"),A=[{regex:u,indices:a,postModify:o},{regex:I,indices:E,postModify:h},{regex:O,indices:{bucket:1,path:2},postModify:h}];for(let w=0;w<A.length;w++){const U=A[w],j=U.regex.exec(t);if(j){const M=j[U.indices.bucket];let D=j[U.indices.path];D||(D=""),n=new B(M,D),U.postModify(n);break}}if(n==null)throw vt(t);return n}}class Bt{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
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
 */function St(e,t,s){let n=1,r=null,o=null,i=!1,u=0;function a(){return u===2}let h=!1;function g(...y){h||(h=!0,t.apply(null,y))}function v(y){r=setTimeout(()=>{r=null,e(I,a())},y)}function N(){o&&clearTimeout(o)}function I(y,...O){if(h){N();return}if(y){N(),g.call(null,y,...O);return}if(a()||i){N(),g.call(null,y,...O);return}n<64&&(n*=2);let A;u===1?(u=2,A=0):A=(n+Math.random())*1e3,v(A)}let E=!1;function x(y){E||(E=!0,N(),!h&&(r!==null?(y||(u=2),clearTimeout(r),v(0)):y||(u=1)))}return v(0),o=setTimeout(()=>{i=!0,x(!0)},s),x}function Ct(e){e(!1)}/**
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
 */function Lt(e){return e!==void 0}function Dt(e){return typeof e=="object"&&!Array.isArray(e)}function Se(e){return typeof e=="string"||e instanceof String}function ke(e){return he()&&e instanceof Blob}function he(){return typeof Blob<"u"}function Ne(e,t,s,n){if(n<t)throw ue(`Invalid value for '${e}'. Expected ${t} or greater.`);if(n>s)throw ue(`Invalid value for '${e}'. Expected ${s} or less.`)}/**
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
 */function Ce(e,t,s){let n=t;return s==null&&(n=`https://${t}`),`${s}://${n}/v0${e}`}function Ft(e){const t=encodeURIComponent;let s="?";for(const n in e)if(e.hasOwnProperty(n)){const r=t(n)+"="+t(e[n]);s=s+r+"&"}return s=s.slice(0,-1),s}var $;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})($||($={}));/**
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
 */function Mt(e,t){const s=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,o=t.indexOf(e)!==-1;return s||r||o}/**
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
 */class $t{constructor(t,s,n,r,o,i,u,a,h,g,v,N=!0,I=!1){this.url_=t,this.method_=s,this.headers_=n,this.body_=r,this.successCodes_=o,this.additionalRetryCodes_=i,this.callback_=u,this.errorCallback_=a,this.timeout_=h,this.progressCallback_=g,this.connectionFactory_=v,this.retry=N,this.isUsingEmulator=I,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((E,x)=>{this.resolve_=E,this.reject_=x,this.start_()})}start_(){const t=(n,r)=>{if(r){n(!1,new Q(!1,null,!0));return}const o=this.connectionFactory_();this.pendingConnection_=o;const i=u=>{const a=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(a,h)};this.progressCallback_!==null&&o.addUploadProgressListener(i),o.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&o.removeUploadProgressListener(i),this.pendingConnection_=null;const u=o.getErrorCode()===$.NO_ERROR,a=o.getStatus();if(!u||Mt(a,this.additionalRetryCodes_)&&this.retry){const g=o.getErrorCode()===$.ABORT;n(!1,new Q(!1,null,g));return}const h=this.successCodes_.indexOf(a)!==-1;n(!0,new Q(h,o))})},s=(n,r)=>{const o=this.resolve_,i=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const a=this.callback_(u,u.getResponse());Lt(a)?o(a):o()}catch(a){i(a)}else if(u!==null){const a=de();a.serverResponse=u.getErrorText(),this.errorCallback_?i(this.errorCallback_(u,a)):i(a)}else if(r.canceled){const a=this.appDelete_?Be():Et();i(a)}else{const a=At();i(a)}};this.canceled_?s(!1,new Q(!1,null,!0)):this.backoffId_=St(t,s,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&Ct(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class Q{constructor(t,s,n){this.wasSuccessCode=t,this.connection=s,this.canceled=!!n}}function Vt(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function Ht(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function zt(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Yt(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function Xt(e,t,s,n,r,o,i=!0,u=!1){const a=Ft(e.urlParams),h=e.url+a,g=Object.assign({},e.headers);return zt(g,t),Vt(g,s),Ht(g,o),Yt(g,n),new $t(h,e.method,g,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,i,u)}/**
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
 */function qt(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function Wt(...e){const t=qt();if(t!==void 0){const s=new t;for(let n=0;n<e.length;n++)s.append(e[n]);return s.getBlob()}else{if(he())return new Blob(e);throw new _(b.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Gt(e,t,s){return e.webkitSlice?e.webkitSlice(t,s):e.mozSlice?e.mozSlice(t,s):e.slice?e.slice(t,s):null}/**
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
 */function Kt(e){if(typeof atob>"u")throw It("base-64");return atob(e)}/**
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
 */const L={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class ie{constructor(t,s){this.data=t,this.contentType=s||null}}function Zt(e,t){switch(e){case L.RAW:return new ie(Le(t));case L.BASE64:case L.BASE64URL:return new ie(De(e,t));case L.DATA_URL:return new ie(Qt(t),en(t))}throw de()}function Le(e){const t=[];for(let s=0;s<e.length;s++){let n=e.charCodeAt(s);if(n<=127)t.push(n);else if(n<=2047)t.push(192|n>>6,128|n&63);else if((n&64512)===55296)if(!(s<e.length-1&&(e.charCodeAt(s+1)&64512)===56320))t.push(239,191,189);else{const o=n,i=e.charCodeAt(++s);n=65536|(o&1023)<<10|i&1023,t.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|n&63)}else(n&64512)===56320?t.push(239,191,189):t.push(224|n>>12,128|n>>6&63,128|n&63)}return new Uint8Array(t)}function Jt(e){let t;try{t=decodeURIComponent(e)}catch{throw G(L.DATA_URL,"Malformed data URL.")}return Le(t)}function De(e,t){switch(e){case L.BASE64:{const r=t.indexOf("-")!==-1,o=t.indexOf("_")!==-1;if(r||o)throw G(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case L.BASE64URL:{const r=t.indexOf("+")!==-1,o=t.indexOf("/")!==-1;if(r||o)throw G(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let s;try{s=Kt(t)}catch(r){throw r.message.includes("polyfill")?r:G(e,"Invalid character found")}const n=new Uint8Array(s.length);for(let r=0;r<s.length;r++)n[r]=s.charCodeAt(r);return n}class Fe{constructor(t){this.base64=!1,this.contentType=null;const s=t.match(/^data:([^,]+)?,/);if(s===null)throw G(L.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const n=s[1]||null;n!=null&&(this.base64=tn(n,";base64"),this.contentType=this.base64?n.substring(0,n.length-7):n),this.rest=t.substring(t.indexOf(",")+1)}}function Qt(e){const t=new Fe(e);return t.base64?De(L.BASE64,t.rest):Jt(t.rest)}function en(e){return new Fe(e).contentType}function tn(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
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
 */class F{constructor(t,s){let n=0,r="";ke(t)?(this.data_=t,n=t.size,r=t.type):t instanceof ArrayBuffer?(s?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),n=this.data_.length):t instanceof Uint8Array&&(s?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),n=t.length),this.size_=n,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,s){if(ke(this.data_)){const n=this.data_,r=Gt(n,t,s);return r===null?null:new F(r)}else{const n=new Uint8Array(this.data_.buffer,t,s-t);return new F(n,!0)}}static getBlob(...t){if(he()){const s=t.map(n=>n instanceof F?n.data_:n);return new F(Wt.apply(null,s))}else{const s=t.map(i=>Se(i)?Zt(L.RAW,i).data:i.data_);let n=0;s.forEach(i=>{n+=i.byteLength});const r=new Uint8Array(n);let o=0;return s.forEach(i=>{for(let u=0;u<i.length;u++)r[o++]=i[u]}),new F(r,!0)}}uploadData(){return this.data_}}/**
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
 */function nn(e){let t;try{t=JSON.parse(e)}catch{return null}return Dt(t)?t:null}/**
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
 */function sn(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function rn(e,t){const s=t.split("/").filter(n=>n.length>0).join("/");return e.length===0?s:e+"/"+s}function Me(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
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
 */function on(e,t){return t}class P{constructor(t,s,n,r){this.server=t,this.local=s||t,this.writable=!!n,this.xform=r||on}}let ee=null;function an(e){return!Se(e)||e.length<2?e:Me(e)}function ln(){if(ee)return ee;const e=[];e.push(new P("bucket")),e.push(new P("generation")),e.push(new P("metageneration")),e.push(new P("name","fullPath",!0));function t(o,i){return an(i)}const s=new P("name");s.xform=t,e.push(s);function n(o,i){return i!==void 0?Number(i):i}const r=new P("size");return r.xform=n,e.push(r),e.push(new P("timeCreated")),e.push(new P("updated")),e.push(new P("md5Hash",null,!0)),e.push(new P("cacheControl",null,!0)),e.push(new P("contentDisposition",null,!0)),e.push(new P("contentEncoding",null,!0)),e.push(new P("contentLanguage",null,!0)),e.push(new P("contentType",null,!0)),e.push(new P("metadata","customMetadata",!0)),ee=e,ee}function cn(e,t){function s(){const n=e.bucket,r=e.fullPath,o=new B(n,r);return t._makeStorageReference(o)}Object.defineProperty(e,"ref",{get:s})}function un(e,t,s){const n={};n.type="file";const r=s.length;for(let o=0;o<r;o++){const i=s[o];n[i.local]=i.xform(n,t[i.server])}return cn(n,e),n}function dn(e,t,s){const n=nn(t);return n===null?null:un(e,n,s)}function hn(e,t){const s={},n=t.length;for(let r=0;r<n;r++){const o=t[r];o.writable&&(s[o.server]=e[o.local])}return JSON.stringify(s)}class $e{constructor(t,s,n,r){this.url=t,this.method=s,this.handler=n,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
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
 */function pn(e){if(!e)throw de()}function fn(e,t){function s(n,r){const o=dn(e,r,t);return pn(o!==null),o}return s}function Ve(e){function t(s,n){let r;return s.getStatus()===401?s.getErrorText().includes("Firebase App Check token is invalid")?r=kt():r=Tt():s.getStatus()===402?r=wt(e.bucket):s.getStatus()===403?r=Nt(e.path):r=n,r.status=s.getStatus(),r.serverResponse=n.serverResponse,r}return t}function mn(e){const t=Ve(e);function s(n,r){let o=t(n,r);return n.getStatus()===404&&(o=Rt(e.path)),o.serverResponse=r.serverResponse,o}return s}function gn(e,t){const s=t.fullServerUrl(),n=Ce(s,e.host,e._protocol),r="DELETE",o=e.maxOperationRetryTime;function i(a,h){}const u=new $e(n,r,i,o);return u.successCodes=[200,204],u.errorHandler=mn(t),u}function bn(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function _n(e,t,s){const n=Object.assign({},s);return n.fullPath=e.path,n.size=t.size(),n.contentType||(n.contentType=bn(null,t)),n}function yn(e,t,s,n,r){const o=t.bucketOnlyServerUrl(),i={"X-Goog-Upload-Protocol":"multipart"};function u(){let A="";for(let w=0;w<2;w++)A=A+Math.random().toString().slice(2);return A}const a=u();i["Content-Type"]="multipart/related; boundary="+a;const h=_n(t,n,r),g=hn(h,s),v="--"+a+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+g+`\r
--`+a+`\r
Content-Type: `+h.contentType+`\r
\r
`,N=`\r
--`+a+"--",I=F.getBlob(v,n,N);if(I===null)throw Ut();const E={name:h.fullPath},x=Ce(o,e.host,e._protocol),y="POST",O=e.maxUploadRetryTime,R=new $e(x,y,fn(e,s),O);return R.urlParams=E,R.headers=i,R.body=I.uploadData(),R.errorHandler=Ve(t),R}/**
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
 */class xn{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=$.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=$.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=$.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,s,n,r,o){if(this.sent_)throw W("cannot .send() more than once");if(Pe(t)&&n&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(s,t,!0),o!==void 0)for(const i in o)o.hasOwnProperty(i)&&this.xhr_.setRequestHeader(i,o[i].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw W("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw W("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw W("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw W("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class Rn extends xn{initXhr(){this.xhr_.responseType="text"}}function He(){return new Rn}/**
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
 */class V{constructor(t,s){this._service=t,s instanceof B?this._location=s:this._location=B.makeFromUrl(s,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,s){return new V(t,s)}get root(){const t=new B(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return Me(this._location.path)}get storage(){return this._service}get parent(){const t=sn(this._location.path);if(t===null)return null;const s=new B(this._location.bucket,t);return new V(this._service,s)}_throwIfRoot(t){if(this._location.path==="")throw jt(t)}}function wn(e,t,s){e._throwIfRoot("uploadBytes");const n=yn(e.storage,e._location,ln(),new F(t,!0),s);return e.storage.makeRequestWithTokens(n,He).then(r=>({metadata:r,ref:e}))}function Tn(e){e._throwIfRoot("deleteObject");const t=gn(e.storage,e._location);return e.storage.makeRequestWithTokens(t,He)}function kn(e,t){const s=rn(e._location.path,t),n=new B(e._location.bucket,s);return new V(e.storage,n)}/**
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
 */function Nn(e){return/^[A-Za-z]+:\/\//.test(e)}function An(e,t){return new V(e,t)}function ze(e,t){if(e instanceof pe){const s=e;if(s._bucket==null)throw Pt();const n=new V(s,s._bucket);return t!=null?ze(n,t):n}else return t!==void 0?kn(e,t):e}function En(e,t){if(t&&Nn(t)){if(e instanceof pe)return An(e,t);throw ue("To use ref(service, url), the first argument must be a Storage instance.")}else return ze(e,t)}function Ae(e,t){const s=t==null?void 0:t[je];return s==null?null:B.makeFromBucketSpec(s,e)}function vn(e,t,s,n={}){e.host=`${t}:${s}`;const r=Pe(t);r&&Qe(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:o}=n;o&&(e._overrideAuthToken=typeof o=="string"?o:et(o,e.app.options.projectId))}class pe{constructor(t,s,n,r,o,i=!1){this.app=t,this._authProvider=s,this._appCheckProvider=n,this._url=r,this._firebaseVersion=o,this._isUsingEmulator=i,this._bucket=null,this._host=Ie,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=yt,this._maxUploadRetryTime=xt,this._requests=new Set,r!=null?this._bucket=B.makeFromBucketSpec(r,this._host):this._bucket=Ae(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=B.makeFromBucketSpec(this._url,t):this._bucket=Ae(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){Ne("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){Ne("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const s=await t.getToken();if(s!==null)return s.accessToken}return null}async _getAppCheckToken(){if(Ze(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new V(this,t)}_makeRequest(t,s,n,r,o=!0){if(this._deleted)return new Bt(Be());{const i=Xt(t,this._appId,n,r,s,this._firebaseVersion,o,this._isUsingEmulator);return this._requests.add(i),i.getPromise().then(()=>this._requests.delete(i),()=>this._requests.delete(i)),i}}async makeRequestWithTokens(t,s){const[n,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,s,n,r).getPromise()}}const Ee="@firebase/storage",ve="0.14.4";/**
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
 */const Ye="storage";function On(e,t,s){return e=ne(e),wn(e,t,s)}function Pn(e){return e=ne(e),Tn(e)}function Xe(e,t){return e=ne(e),En(e,t)}function Un(e=Ke(),t){e=ne(e);const n=We(e,Ye).getImmediate({identifier:t}),r=Ge("storage");return r&&In(n,...r),n}function In(e,t,s,n={}){vn(e,t,s,n)}/**
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
 */function jn(e,{instanceIdentifier:t}){const s=e.getProvider("app").getImmediate(),n=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new pe(s,n,r,t,st)}function Bn(){tt(new nt(Ye,jn,"PUBLIC").setMultipleInstances(!0)),xe(Ee,ve,""),xe(Ee,ve,"esm2020")}Bn();let ae=null;function Sn(){const e=globalThis.crypto;return e&&typeof e.randomUUID=="function"?e.randomUUID():`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}function qe(){return ae||(ae=Un(rt)),ae}async function Cn({uid:e,file:t}){const s=Ue(t,{types:te,maxBytes:ce,exclusive:!0});if(s)throw new Error(s);const n=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=Sn(),o=`profile-photos/${e}/${r}/photo.${n}`;return await On(Xe(qe(),o),t,{contentType:t.type}),{path:o}}async function le(e){if(!(typeof e!="string"||!e.startsWith("profile-photos/")))try{await Pn(Xe(qe(),e))}catch(t){if(t&&t.code==="storage/object-not-found")return;throw t}}const Ln=m.forwardRef(function({uid:t,value:s,onChange:n,onPendingChange:r},o){const i=m.useRef(null),[u,a]=m.useState(null),[h,g]=m.useState(!1),[v,N]=m.useState(null),[I,E]=m.useState(null),[x,y]=m.useState(null),O=m.useRef(null),R=m.useRef(null);m.useEffect(()=>()=>{x&&URL.revokeObjectURL(x)},[x]);function A(p){r==null||r(p)}function w(p){const l=URL.createObjectURL(p);y(d=>(d&&URL.revokeObjectURL(d),l))}function U(p){O.current=p,E(p)}function j(p){R.current=p}const M=m.useCallback(()=>{y(p=>(p&&URL.revokeObjectURL(p),null)),U(null),N(null),r==null||r(!1)},[r]);async function D(p){if(h)return;const l=R.current;if(l){try{await le(l)}catch{a("Your new photo is still public. Try again.");return}j(null)}a(null),N(null),U(p),w(p),A(!1),i.current&&(i.current.value="")}async function K(p){if(h)return;const l=R.current;if(l){try{await le(l)}catch{a("Your new photo is still public. Try again.");return}j(null)}M(),n(p)}m.useImperativeHandle(o,()=>({hasPending(){return O.current!==null},async commit(){const p=O.current;if(!p)return null;if(R.current)return n(R.current),R.current;g(!0),r==null||r(!0),a(null);try{const{path:l}=await Cn({uid:t,file:p});return j(l),n(l),l}catch(l){throw a("Your photo could not be uploaded. Try again."),l}finally{g(!1),r==null||r(!1)}},release(){M(),j(null)},async discard(){const p=R.current;p&&(await le(p),j(null))}}),[M,n,r,t]);async function S(p){var f;const l=((f=p.target.files)==null?void 0:f[0])??null;if(!l)return;const d=Ue(l,{types:te,maxBytes:ce,exclusive:!0});if(d){a(d),i.current&&(i.current.value="");return}i.current&&(i.current.value=""),N(l),A(!0)}function se(){K("")}const X=ot(s);return c.jsxs("div",{className:"flex flex-col gap-2",children:[c.jsx("span",{className:"block font-semibold text-text-primary",children:"Photo"}),c.jsxs("div",{className:"flex items-center gap-4",children:[x?c.jsx("img",{src:x,alt:"Your new profile photo",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):s&&!X?c.jsx(it,{path:s,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):X?c.jsx("img",{src:X,alt:"Your chosen default avatar",className:"h-20 w-20 rounded-brand bg-surface-alt object-cover"}):c.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-text-primary/20 text-xs text-text-secondary",children:"None"}),c.jsxs("div",{className:"flex flex-col gap-2",children:[c.jsx("label",{htmlFor:"profile-photo",className:"file-input-label touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-text-primary/20 bg-surface px-4 py-2 font-semibold text-text-primary hover:bg-surface-alt",children:h?"Uploading…":s||I?"Replace photo":"Upload a photo"}),c.jsx("input",{id:"profile-photo",ref:i,type:"file",accept:te.join(","),className:"sr-only",disabled:h,onChange:S,"aria-describedby":"profile-photo-hint"}),s||I?c.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-text-secondary underline hover:bg-surface-alt",onClick:se,disabled:h,children:"Remove photo"}):null]})]}),v?c.jsx(mt,{file:v,label:"your profile photo",onApply:p=>D(p),onCancel:()=>{N(null),A(!1)}}):null,c.jsx(gt,{value:s,onChange:K,namePrefix:"profile"}),c.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-text-secondary",children:[te.map(at).join(", ")," · up to"," ",lt(ce),". Save your profile to publish the change."]}),u?c.jsx("p",{role:"alert",className:"text-sm text-danger",children:u}):null]})}),Oe={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function Dn(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id,maxPicks:Number.isInteger(s.maxPicks)&&s.maxPicks>0?s.maxPicks:null,badges:(Array.isArray(s.badges)?s.badges:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id}))})).filter(s=>s.badges.length>0)}const Fn=5;function Mn(e){return e.reduce((t,s)=>t+Math.min(s.maxPicks??s.badges.length,s.badges.length),0)}function zn(){const{user:e}=ct(),{features:t,badges:s}=ut(),{profile:n,status:r,needsProfileSetup:o,saveProfile:i}=dt(),{showToast:u}=ht(),[a,h]=m.useState(null),[g,v]=m.useState(!1),[N,I]=m.useState(!1),E=m.useRef(null),[x,y]=m.useState(null),[O,R]=m.useState(null),A=m.useRef(null),w=m.useRef([]),U=m.useRef([]),j=m.useRef([]);if(m.useEffect(()=>{a!=null||n==null||(U.current=Array.isArray(n.customBadges)?n.customBadges:[],j.current=U.current,h({displayName:n.displayName??"",pronouns:n.pronouns??"",jobTitle:n.jobTitle??"",organization:n.organization??"",bio:n.bio??"",profileVisibility:n.profileVisibility??"attendees_only",badges:Array.isArray(n.badges)?n.badges:[],customBadges:Array.from({length:z.MAX_CUSTOM_BADGES},(l,d)=>{var f;return typeof((f=n.customBadges)==null?void 0:f[d])=="string"?n.customBadges[d]:""}),photoPath:typeof n.photoPath=="string"?n.photoPath:""}))},[n,a]),m.useEffect(()=>{if(!n)return;const l=k=>typeof k=="string"?k.trim().replace(/\s+/g," ").toLowerCase():"",d=Array.isArray(n.customBadges)?n.customBadges:[],f=new Set(d.map(l)),T=new Set(j.current.map(l).filter(k=>!f.has(k)));j.current=d,T.size&&(U.current=U.current.filter(k=>!T.has(l(k))),h(k=>k&&{...k,customBadges:k.customBadges.map(q=>T.has(l(q))?"":q)}))},[n]),!e)return c.jsx(Re,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:c.jsx(pt,{to:"/signin",className:we,children:"Go to sign in"})});if(r==="pending-account"||a==null)return c.jsx(Re,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const M=ft.PROFILE_VISIBILITIES.filter(l=>l!=="public"||t.publicAttendeeProfiles||a.profileVisibility==="public"),D=t.badges?Dn(s):[],K=z.MAX_TOTAL_BADGES-Mn(D)<=Fn,S=(l,d)=>h(f=>({...f,[l]:d})),se=l=>h(d=>({...d,badges:d.badges.includes(l)?d.badges.filter(f=>f!==l):[...d.badges,l]})),X=(l,d)=>{h(f=>({...f,customBadges:f.customBadges.map((T,k)=>k===l?d:T)})),R(null)},p=async l=>{var fe,me,ge,be,_e;if(l.preventDefault(),N||g)return;if(a.displayName.trim().length===0){y("Enter the name you want other attendees to see."),(fe=A.current)==null||fe.focus();return}y(null);let d;const f=C=>C.filter(H=>typeof H=="string"&&H.trim().length>0),T=f(a.customBadges),k=f(U.current),q=JSON.stringify(T)!==JSON.stringify(k);if(t.customBadges===!0){const C=z.validateCustomBadges(T,{blockList:s==null?void 0:s.customBadgeBlockList});if(C.rejected.length>0){let H=0,re=[];for(let J=0;J<a.customBadges.length;J+=1){const ye=a.customBadges[J];if(ye.trim()&&(re=[...re,ye],z.validateCustomBadges(re,{blockList:s==null?void 0:s.customBadgeBlockList}).rejected.length>0)){H=J;break}}R({index:H,message:"Choose another custom badge. Use 24 characters or fewer, use only letters, numbers, spaces, apostrophes, hyphens, or periods, and do not use a blocked or repeated badge."}),(me=w.current[H])==null||me.focus();return}d=C.valid}R(null),v(!0);let Z=null;try{let C=a.photoPath?a.photoPath:null;if((ge=E.current)!=null&&ge.hasPending()){try{Z=await E.current.commit()}catch{u("Your photo could not be uploaded. Try again.",{tone:"error"});return}C=Z}await i({displayName:a.displayName.trim(),pronouns:a.pronouns.trim(),jobTitle:a.jobTitle.trim(),organization:a.organization.trim(),bio:a.bio.trim(),profileVisibility:a.profileVisibility,badges:a.badges,...t.customBadges===!0&&q?{customBadges:d}:{},photoPath:C}),(be=E.current)==null||be.release(),t.customBadges===!0&&q&&(U.current=d),u("Profile saved.")}catch{let C=!1;if(Z&&Z!==(n==null?void 0:n.photoPath))try{await((_e=E.current)==null?void 0:_e.discard()),S("photoPath",n!=null&&n.photoPath?n.photoPath:"")}catch{C=!0}u(C?"Your profile could not be saved. The new photo is still public. Try again.":"Your profile could not be saved. Try again.",{tone:"error"})}finally{v(!1)}};return c.jsxs("article",{className:"mx-auto max-w-2xl",children:[c.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:o?"Complete your profile":"Your profile"}),c.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),c.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:p,noValidate:!0,children:[c.jsx(Ln,{ref:E,uid:e.uid,value:a.photoPath,onChange:l=>S("photoPath",l),onPendingChange:I}),c.jsxs("div",{children:[c.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),c.jsx("input",{id:"displayName",ref:A,className:`mt-2xs ${Y}`,value:a.displayName,onChange:l=>S("displayName",l.target.value),"aria-invalid":x?"true":void 0,"aria-describedby":x?"displayName-error":void 0,autoComplete:"name"}),x?c.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:x}):null]}),c.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[c.jsxs("div",{children:[c.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),c.jsx("input",{id:"pronouns",className:`mt-2xs ${Y}`,value:a.pronouns,onChange:l=>S("pronouns",l.target.value)})]}),c.jsxs("div",{children:[c.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),c.jsx("input",{id:"jobTitle",className:`mt-2xs ${Y}`,value:a.jobTitle,onChange:l=>S("jobTitle",l.target.value),autoComplete:"organization-title"})]})]}),c.jsxs("div",{children:[c.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),c.jsx("input",{id:"organization",className:`mt-2xs ${Y}`,value:a.organization,onChange:l=>S("organization",l.target.value),autoComplete:"organization"})]}),c.jsxs("div",{children:[c.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),c.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${Y}`,value:a.bio,onChange:l=>S("bio",l.target.value)})]}),c.jsxs("fieldset",{children:[c.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),c.jsx("div",{className:"mt-xs space-y-xs",children:M.map(l=>c.jsx(bt,{name:"profileVisibility",value:l,label:Oe[l].label,description:Oe[l].description,checked:a.profileVisibility===l,onChange:()=>S("profileVisibility",l)},l))})]}),D.length>0?c.jsxs("section",{className:"mt-xl",children:[c.jsx(Te,{level:2,title:"Badges"}),K?c.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",z.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,D.map(l=>{const d=l.badges.filter(T=>a.badges.includes(T.id)).length,f=l.maxPicks!=null&&d>=l.maxPicks;return c.jsxs("fieldset",{className:"mt-md",children:[c.jsx("legend",{className:"font-semibold text-text-primary",children:l.label}),l.maxPicks!=null?c.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:f?`You’ve picked all ${l.maxPicks} — clear one to choose another.`:`Pick up to ${l.maxPicks} (${d} chosen).`}):null,c.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:l.badges.map(T=>{const k=a.badges.includes(T.id);return c.jsx(_t,{label:T.label,checked:k,disabled:!k&&f,className:!k&&f?"text-text-secondary":"",onChange:()=>se(T.id)},T.id)})})]},l.id)})]}):null,t.customBadges===!0?c.jsxs("section",{className:"mt-xl",children:[c.jsx(Te,{level:2,title:"Custom badges"}),c.jsx("div",{className:"mt-md grid gap-md sm:grid-cols-3",children:a.customBadges.map((l,d)=>{const f=(O==null?void 0:O.index)===d?O.message:null;return c.jsxs("div",{children:[c.jsxs("label",{htmlFor:`customBadge-${d}`,className:"block font-semibold text-text-primary",children:["Custom badge ",d+1]}),c.jsx("input",{id:`customBadge-${d}`,ref:T=>{w.current[d]=T},className:`mt-2xs ${Y}`,value:l,maxLength:z.MAX_CUSTOM_BADGE_LENGTH,onChange:T=>X(d,T.target.value),"aria-invalid":f?"true":void 0,"aria-describedby":f?`customBadge-${d}-error`:void 0}),f?c.jsx("p",{id:`customBadge-${d}-error`,role:"alert",className:"mt-2xs font-data text-caption text-danger",children:f}):null]},d)})})]}):null,c.jsx("button",{type:"submit",className:we,disabled:g||N,children:g?"Saving…":"Save profile"})]})]})}export{zn as default};
