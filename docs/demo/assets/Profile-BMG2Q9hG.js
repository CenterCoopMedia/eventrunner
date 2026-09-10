import{aG as V,aH as Ee,aI as Ae,aJ as Pe,aK as Oe,aL as ve,aM as le,aN as Ie,aO as Ce,aP as Ue,aQ as Se,aR as J,aS as je,v as ce,aT as $,aU as X,aV as De,r as I,j as l,A as Le,q as Be,p as Fe,a as Me,u as $e,ar as Ve,g as He,af as Q,L as ze,ag as ee,aW as qe,aX as te,aA as D,ak as We}from"./index-CwcqxPvT.js";import{R as Xe,C as Ye}from"./Choice-D_77nC1g.js";/**
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
 */const ue="firebasestorage.googleapis.com",he="storageBucket",Ge=2*60*1e3,Ke=10*60*1e3;/**
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
 */class f extends ve{constructor(t,n,s=0){super(z(t),`Firebase Storage: ${n} (${z(t)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,f.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return z(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var p;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(p||(p={}));function z(e){return"storage/"+e}function G(){const e="An unknown error occurred, please check the error payload for server response.";return new f(p.UNKNOWN,e)}function Ze(e){return new f(p.OBJECT_NOT_FOUND,"Object '"+e+"' does not exist.")}function Je(e){return new f(p.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function Qe(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new f(p.UNAUTHENTICATED,e)}function et(){return new f(p.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function tt(e){return new f(p.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function nt(){return new f(p.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function st(){return new f(p.CANCELED,"User canceled the upload/download.")}function rt(e){return new f(p.INVALID_URL,"Invalid URL '"+e+"'.")}function it(e){return new f(p.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function ot(){return new f(p.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+he+"' property when initializing the app?")}function at(){return new f(p.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function lt(e){return new f(p.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function Y(e){return new f(p.INVALID_ARGUMENT,e)}function de(){return new f(p.APP_DELETED,"The Firebase app was deleted.")}function ct(e){return new f(p.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function B(e,t){return new f(p.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function L(e){throw new f(p.INTERNAL_ERROR,"Internal error: "+e)}/**
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
 */class N{constructor(t,n){this.bucket=t,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,n){let s;try{s=N.makeFromUrl(t,n)}catch{return new N(t,"")}if(s.path==="")return s;throw it(t)}static makeFromUrl(t,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function i(x){x.path.charAt(x.path.length-1)==="/"&&(x.path_=x.path_.slice(0,-1))}const o="(/(.*))?$",u=new RegExp("^gs://"+r+o,"i"),a={bucket:1,path:3};function h(x){x.path_=decodeURIComponent(x.path)}const d="v[A-Za-z0-9_]+",_=n.replace(/[.]/g,"\\."),m="(/([^?#]*).*)?$",R=new RegExp(`^https?://${_}/${d}/b/${r}/o${m}`,"i"),k={bucket:1,path:3},E=n===ue?"(?:storage.googleapis.com|storage.cloud.google.com)":n,b="([^?#]*)",A=new RegExp(`^https?://${E}/${r}/${b}`,"i"),g=[{regex:u,indices:a,postModify:i},{regex:R,indices:k,postModify:h},{regex:A,indices:{bucket:1,path:2},postModify:h}];for(let x=0;x<g.length;x++){const j=g[x],c=j.regex.exec(t);if(c){const w=c[j.indices.bucket];let y=c[j.indices.path];y||(y=""),s=new N(w,y),j.postModify(s);break}}if(s==null)throw rt(t);return s}}class ut{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
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
 */function ht(e,t,n){let s=1,r=null,i=null,o=!1,u=0;function a(){return u===2}let h=!1;function d(...b){h||(h=!0,t.apply(null,b))}function _(b){r=setTimeout(()=>{r=null,e(R,a())},b)}function m(){i&&clearTimeout(i)}function R(b,...A){if(h){m();return}if(b){m(),d.call(null,b,...A);return}if(a()||o){m(),d.call(null,b,...A);return}s<64&&(s*=2);let g;u===1?(u=2,g=0):g=(s+Math.random())*1e3,_(g)}let k=!1;function E(b){k||(k=!0,m(),!h&&(r!==null?(b||(u=2),clearTimeout(r),_(0)):b||(u=1)))}return _(0),i=setTimeout(()=>{o=!0,E(!0)},n),E}function dt(e){e(!1)}/**
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
 */function pt(e){return e!==void 0}function ft(e){return typeof e=="object"&&!Array.isArray(e)}function pe(e){return typeof e=="string"||e instanceof String}function ne(e){return K()&&e instanceof Blob}function K(){return typeof Blob<"u"}function se(e,t,n,s){if(s<t)throw Y(`Invalid value for '${e}'. Expected ${t} or greater.`);if(s>n)throw Y(`Invalid value for '${e}'. Expected ${n} or less.`)}/**
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
 */function fe(e,t,n){let s=t;return n==null&&(s=`https://${t}`),`${n}://${s}/v0${e}`}function mt(e){const t=encodeURIComponent;let n="?";for(const s in e)if(e.hasOwnProperty(s)){const r=t(s)+"="+t(e[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var U;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})(U||(U={}));/**
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
 */function gt(e,t){const n=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,i=t.indexOf(e)!==-1;return n||r||i}/**
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
 */class _t{constructor(t,n,s,r,i,o,u,a,h,d,_,m=!0,R=!1){this.url_=t,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=i,this.additionalRetryCodes_=o,this.callback_=u,this.errorCallback_=a,this.timeout_=h,this.progressCallback_=d,this.connectionFactory_=_,this.retry=m,this.isUsingEmulator=R,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((k,E)=>{this.resolve_=k,this.reject_=E,this.start_()})}start_(){const t=(s,r)=>{if(r){s(!1,new F(!1,null,!0));return}const i=this.connectionFactory_();this.pendingConnection_=i;const o=u=>{const a=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(a,h)};this.progressCallback_!==null&&i.addUploadProgressListener(o),i.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&i.removeUploadProgressListener(o),this.pendingConnection_=null;const u=i.getErrorCode()===U.NO_ERROR,a=i.getStatus();if(!u||gt(a,this.additionalRetryCodes_)&&this.retry){const d=i.getErrorCode()===U.ABORT;s(!1,new F(!1,null,d));return}const h=this.successCodes_.indexOf(a)!==-1;s(!0,new F(h,i))})},n=(s,r)=>{const i=this.resolve_,o=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const a=this.callback_(u,u.getResponse());pt(a)?i(a):i()}catch(a){o(a)}else if(u!==null){const a=G();a.serverResponse=u.getErrorText(),this.errorCallback_?o(this.errorCallback_(u,a)):o(a)}else if(r.canceled){const a=this.appDelete_?de():st();o(a)}else{const a=nt();o(a)}};this.canceled_?n(!1,new F(!1,null,!0)):this.backoffId_=ht(t,n,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&dt(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class F{constructor(t,n,s){this.wasSuccessCode=t,this.connection=n,this.canceled=!!s}}function bt(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function xt(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function yt(e,t){t&&(e["X-Firebase-GMPID"]=t)}function Tt(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function Rt(e,t,n,s,r,i,o=!0,u=!1){const a=mt(e.urlParams),h=e.url+a,d=Object.assign({},e.headers);return yt(d,t),bt(d,n),xt(d,i),Tt(d,s),new _t(h,e.method,d,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,o,u)}/**
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
 */function wt(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function kt(...e){const t=wt();if(t!==void 0){const n=new t;for(let s=0;s<e.length;s++)n.append(e[s]);return n.getBlob()}else{if(K())return new Blob(e);throw new f(p.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Nt(e,t,n){return e.webkitSlice?e.webkitSlice(t,n):e.mozSlice?e.mozSlice(t,n):e.slice?e.slice(t,n):null}/**
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
 */function Et(e){if(typeof atob>"u")throw lt("base-64");return atob(e)}/**
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
 */const P={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class q{constructor(t,n){this.data=t,this.contentType=n||null}}function At(e,t){switch(e){case P.RAW:return new q(me(t));case P.BASE64:case P.BASE64URL:return new q(ge(e,t));case P.DATA_URL:return new q(Ot(t),vt(t))}throw G()}function me(e){const t=[];for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);if(s<=127)t.push(s);else if(s<=2047)t.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<e.length-1&&(e.charCodeAt(n+1)&64512)===56320))t.push(239,191,189);else{const i=s,o=e.charCodeAt(++n);s=65536|(i&1023)<<10|o&1023,t.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?t.push(239,191,189):t.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(t)}function Pt(e){let t;try{t=decodeURIComponent(e)}catch{throw B(P.DATA_URL,"Malformed data URL.")}return me(t)}function ge(e,t){switch(e){case P.BASE64:{const r=t.indexOf("-")!==-1,i=t.indexOf("_")!==-1;if(r||i)throw B(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case P.BASE64URL:{const r=t.indexOf("+")!==-1,i=t.indexOf("/")!==-1;if(r||i)throw B(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=Et(t)}catch(r){throw r.message.includes("polyfill")?r:B(e,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class _e{constructor(t){this.base64=!1,this.contentType=null;const n=t.match(/^data:([^,]+)?,/);if(n===null)throw B(P.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=It(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=t.substring(t.indexOf(",")+1)}}function Ot(e){const t=new _e(e);return t.base64?ge(P.BASE64,t.rest):Pt(t.rest)}function vt(e){return new _e(e).contentType}function It(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
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
 */class C{constructor(t,n){let s=0,r="";ne(t)?(this.data_=t,s=t.size,r=t.type):t instanceof ArrayBuffer?(n?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),s=this.data_.length):t instanceof Uint8Array&&(n?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),s=t.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,n){if(ne(this.data_)){const s=this.data_,r=Nt(s,t,n);return r===null?null:new C(r)}else{const s=new Uint8Array(this.data_.buffer,t,n-t);return new C(s,!0)}}static getBlob(...t){if(K()){const n=t.map(s=>s instanceof C?s.data_:s);return new C(kt.apply(null,n))}else{const n=t.map(o=>pe(o)?At(P.RAW,o).data:o.data_);let s=0;n.forEach(o=>{s+=o.byteLength});const r=new Uint8Array(s);let i=0;return n.forEach(o=>{for(let u=0;u<o.length;u++)r[i++]=o[u]}),new C(r,!0)}}uploadData(){return this.data_}}/**
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
 */function Ct(e){let t;try{t=JSON.parse(e)}catch{return null}return ft(t)?t:null}/**
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
 */function Ut(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function St(e,t){const n=t.split("/").filter(s=>s.length>0).join("/");return e.length===0?n:e+"/"+n}function be(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
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
 */function jt(e,t){return t}class T{constructor(t,n,s,r){this.server=t,this.local=n||t,this.writable=!!s,this.xform=r||jt}}let M=null;function Dt(e){return!pe(e)||e.length<2?e:be(e)}function Lt(){if(M)return M;const e=[];e.push(new T("bucket")),e.push(new T("generation")),e.push(new T("metageneration")),e.push(new T("name","fullPath",!0));function t(i,o){return Dt(o)}const n=new T("name");n.xform=t,e.push(n);function s(i,o){return o!==void 0?Number(o):o}const r=new T("size");return r.xform=s,e.push(r),e.push(new T("timeCreated")),e.push(new T("updated")),e.push(new T("md5Hash",null,!0)),e.push(new T("cacheControl",null,!0)),e.push(new T("contentDisposition",null,!0)),e.push(new T("contentEncoding",null,!0)),e.push(new T("contentLanguage",null,!0)),e.push(new T("contentType",null,!0)),e.push(new T("metadata","customMetadata",!0)),M=e,M}function Bt(e,t){function n(){const s=e.bucket,r=e.fullPath,i=new N(s,r);return t._makeStorageReference(i)}Object.defineProperty(e,"ref",{get:n})}function Ft(e,t,n){const s={};s.type="file";const r=n.length;for(let i=0;i<r;i++){const o=n[i];s[o.local]=o.xform(s,t[o.server])}return Bt(s,e),s}function Mt(e,t,n){const s=Ct(t);return s===null?null:Ft(e,s,n)}function $t(e,t){const n={},s=t.length;for(let r=0;r<s;r++){const i=t[r];i.writable&&(n[i.server]=e[i.local])}return JSON.stringify(n)}class xe{constructor(t,n,s,r){this.url=t,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
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
 */function Vt(e){if(!e)throw G()}function Ht(e,t){function n(s,r){const i=Mt(e,r,t);return Vt(i!==null),i}return n}function ye(e){function t(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=et():r=Qe():n.getStatus()===402?r=Je(e.bucket):n.getStatus()===403?r=tt(e.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return t}function zt(e){const t=ye(e);function n(s,r){let i=t(s,r);return s.getStatus()===404&&(i=Ze(e.path)),i.serverResponse=r.serverResponse,i}return n}function qt(e,t){const n=t.fullServerUrl(),s=fe(n,e.host,e._protocol),r="DELETE",i=e.maxOperationRetryTime;function o(a,h){}const u=new xe(s,r,o,i);return u.successCodes=[200,204],u.errorHandler=zt(t),u}function Wt(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function Xt(e,t,n){const s=Object.assign({},n);return s.fullPath=e.path,s.size=t.size(),s.contentType||(s.contentType=Wt(null,t)),s}function Yt(e,t,n,s,r){const i=t.bucketOnlyServerUrl(),o={"X-Goog-Upload-Protocol":"multipart"};function u(){let g="";for(let x=0;x<2;x++)g=g+Math.random().toString().slice(2);return g}const a=u();o["Content-Type"]="multipart/related; boundary="+a;const h=Xt(t,s,r),d=$t(h,n),_="--"+a+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+d+`\r
--`+a+`\r
Content-Type: `+h.contentType+`\r
\r
`,m=`\r
--`+a+"--",R=C.getBlob(_,s,m);if(R===null)throw at();const k={name:h.fullPath},E=fe(i,e.host,e._protocol),b="POST",A=e.maxUploadRetryTime,O=new xe(E,b,Ht(e,n),A);return O.urlParams=k,O.headers=o,O.body=R.uploadData(),O.errorHandler=ye(t),O}/**
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
 */class Gt{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=U.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=U.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=U.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,n,s,r,i){if(this.sent_)throw L("cannot .send() more than once");if(le(t)&&s&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(n,t,!0),i!==void 0)for(const o in i)i.hasOwnProperty(o)&&this.xhr_.setRequestHeader(o,i[o].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw L("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw L("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw L("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw L("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class Kt extends Gt{initXhr(){this.xhr_.responseType="text"}}function Te(){return new Kt}/**
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
 */class S{constructor(t,n){this._service=t,n instanceof N?this._location=n:this._location=N.makeFromUrl(n,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,n){return new S(t,n)}get root(){const t=new N(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return be(this._location.path)}get storage(){return this._service}get parent(){const t=Ut(this._location.path);if(t===null)return null;const n=new N(this._location.bucket,t);return new S(this._service,n)}_throwIfRoot(t){if(this._location.path==="")throw ct(t)}}function Zt(e,t,n){e._throwIfRoot("uploadBytes");const s=Yt(e.storage,e._location,Lt(),new C(t,!0),n);return e.storage.makeRequestWithTokens(s,Te).then(r=>({metadata:r,ref:e}))}function Jt(e){e._throwIfRoot("deleteObject");const t=qt(e.storage,e._location);return e.storage.makeRequestWithTokens(t,Te)}function Qt(e,t){const n=St(e._location.path,t),s=new N(e._location.bucket,n);return new S(e.storage,s)}/**
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
 */function en(e){return/^[A-Za-z]+:\/\//.test(e)}function tn(e,t){return new S(e,t)}function Re(e,t){if(e instanceof Z){const n=e;if(n._bucket==null)throw ot();const s=new S(n,n._bucket);return t!=null?Re(s,t):s}else return t!==void 0?Qt(e,t):e}function nn(e,t){if(t&&en(t)){if(e instanceof Z)return tn(e,t);throw Y("To use ref(service, url), the first argument must be a Storage instance.")}else return Re(e,t)}function re(e,t){const n=t==null?void 0:t[he];return n==null?null:N.makeFromBucketSpec(n,e)}function sn(e,t,n,s={}){e.host=`${t}:${n}`;const r=le(t);r&&Ie(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:i}=s;i&&(e._overrideAuthToken=typeof i=="string"?i:Ce(i,e.app.options.projectId))}class Z{constructor(t,n,s,r,i,o=!1){this.app=t,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=i,this._isUsingEmulator=o,this._bucket=null,this._host=ue,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=Ge,this._maxUploadRetryTime=Ke,this._requests=new Set,r!=null?this._bucket=N.makeFromBucketSpec(r,this._host):this._bucket=re(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=N.makeFromBucketSpec(this._url,t):this._bucket=re(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){se("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){se("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const n=await t.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){if(Oe(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new S(this,t)}_makeRequest(t,n,s,r,i=!0){if(this._deleted)return new ut(de());{const o=Rt(t,this._appId,s,r,n,this._firebaseVersion,i,this._isUsingEmulator);return this._requests.add(o),o.getPromise().then(()=>this._requests.delete(o),()=>this._requests.delete(o)),o}}async makeRequestWithTokens(t,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,n,s,r).getPromise()}}const ie="@firebase/storage",oe="0.14.4";/**
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
 */const we="storage";function rn(e,t,n){return e=V(e),Zt(e,t,n)}function on(e){return e=V(e),Jt(e)}function ke(e,t){return e=V(e),nn(e,t)}function an(e=Pe(),t){e=V(e);const s=Ee(e,we).getImmediate({identifier:t}),r=Ae("storage");return r&&ln(s,...r),s}function ln(e,t,n,s={}){sn(e,t,n,s)}/**
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
 */function cn(e,{instanceIdentifier:t}){const n=e.getProvider("app").getImmediate(),s=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new Z(n,s,r,t,je)}function un(){Ue(new Se(we,cn,"PUBLIC").setMultipleInstances(!0)),J(ie,oe,""),J(ie,oe,"esm2020")}un();let W=null;function Ne(){return W||(W=an(De)),W}async function hn({uid:e,file:t}){const n=ce(t,{types:$,maxBytes:X,exclusive:!0});if(n)throw new Error(n);const s=t.type==="image/png"?"png":t.type==="image/webp"?"webp":"jpg",r=`profile-photos/${e}/photo.${s}`;return await rn(ke(Ne(),r),t,{contentType:t.type}),{path:r}}async function dn(e){if(!(typeof e!="string"||!e.startsWith("profile-photos/")))try{await on(ke(Ne(),e))}catch{}}function pn({uid:e,value:t,onChange:n}){const s=I.useRef(null),[r,i]=I.useState(null),[o,u]=I.useState(!1);async function a(d){var R;const _=((R=d.target.files)==null?void 0:R[0])??null;if(!_)return;const m=ce(_,{types:$,maxBytes:X,exclusive:!0});if(m){i(m);return}u(!0),i(null);try{const{path:k}=await hn({uid:e,file:_});n(k)}catch{i("Your photo could not be uploaded. Try again.")}finally{u(!1),s.current&&(s.current.value="")}}function h(){n("")}return l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("span",{className:"block font-semibold text-brand-ink",children:"Photo"}),l.jsxs("div",{className:"flex items-center gap-4",children:[t?l.jsx(Le,{path:t,alt:"Your current profile photo",className:"h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"}):l.jsx("span",{"aria-hidden":"true",className:"flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-brand-ink/20 text-xs text-brand-ink-muted",children:"None"}),l.jsxs("div",{className:"flex flex-col gap-2",children:[l.jsx("label",{htmlFor:"profile-photo",className:"touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt",children:o?"Uploading…":t?"Replace photo":"Upload a photo"}),l.jsx("input",{id:"profile-photo",ref:s,type:"file",accept:$.join(","),className:"sr-only",disabled:o,onChange:a,"aria-describedby":"profile-photo-hint"}),t?l.jsx("button",{type:"button",className:"touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-brand-ink-muted underline hover:bg-brand-surface-alt",onClick:h,disabled:o,children:"Remove photo"}):null]})]}),l.jsxs("p",{id:"profile-photo-hint",className:"text-sm text-brand-ink-muted",children:[$.map(Be).join(", ")," · up to"," ",Fe(X),". Save your profile to publish the change."]}),r?l.jsx("p",{role:"alert",className:"text-sm text-danger",children:r}):null]})}const ae={public:{label:"Anyone",description:"Your profile appears in the directory and is readable by anyone, signed in or not."},attendees_only:{label:"Attendees only",description:"Only approved attendees and speakers can see your profile."},private:{label:"Nobody",description:"You are left out of the directory entirely."}};function fn(e){return(Array.isArray(e==null?void 0:e.categories)?e.categories:[]).filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,label:typeof n.label=="string"&&n.label?n.label:n.id,maxPicks:Number.isInteger(n.maxPicks)&&n.maxPicks>0?n.maxPicks:null,badges:(Array.isArray(n.badges)?n.badges:[]).filter(s=>s&&typeof s.id=="string").map(s=>({id:s.id,label:typeof s.label=="string"&&s.label?s.label:s.id}))})).filter(n=>n.badges.length>0)}const mn=5;function gn(e){return e.reduce((t,n)=>t+Math.min(n.maxPicks??n.badges.length,n.badges.length),0)}function xn(){const{user:e}=Me(),{features:t,badges:n}=$e(),{profile:s,status:r,needsProfileSetup:i,saveProfile:o}=Ve(),{showToast:u}=He(),[a,h]=I.useState(null),[d,_]=I.useState(!1),[m,R]=I.useState(null),k=I.useRef(null),E=I.useRef(null);if(I.useEffect(()=>{a!=null||s==null||(h({displayName:s.displayName??"",pronouns:s.pronouns??"",jobTitle:s.jobTitle??"",organization:s.organization??"",bio:s.bio??"",profileVisibility:s.profileVisibility??"attendees_only",badges:Array.isArray(s.badges)?s.badges:[],photoPath:typeof s.photoPath=="string"?s.photoPath:""}),E.current=typeof s.photoPath=="string"?s.photoPath:null)},[s,a]),!e)return l.jsx(Q,{title:"Sign in to set up your profile",description:"Your profile is part of your account, so it lives behind sign-in.",action:l.jsx(ze,{to:"/signin",className:ee,children:"Go to sign in"})});if(r==="pending-account"||a==null)return l.jsx(Q,{title:"Setting up your account",description:"This takes a moment after your first sign-in. The form appears as soon as your account is ready."});const b=qe.PROFILE_VISIBILITIES.filter(c=>c!=="public"||t.publicAttendeeProfiles||a.profileVisibility==="public"),A=t.badges?fn(n):[],O=te.MAX_TOTAL_BADGES-gn(A)<=mn,g=(c,w)=>h(y=>({...y,[c]:w})),x=c=>h(w=>({...w,badges:w.badges.includes(c)?w.badges.filter(y=>y!==c):[...w.badges,c]})),j=async c=>{var w;if(c.preventDefault(),a.displayName.trim().length===0){R("Enter the name you want other attendees to see."),(w=k.current)==null||w.focus();return}R(null),_(!0);try{await o({displayName:a.displayName.trim(),pronouns:a.pronouns.trim(),jobTitle:a.jobTitle.trim(),organization:a.organization.trim(),bio:a.bio.trim(),profileVisibility:a.profileVisibility,badges:a.badges,photoPath:a.photoPath?a.photoPath:null});const y=E.current,v=a.photoPath?a.photoPath:null;E.current=v,y&&y!==v&&await dn(y),u("Profile saved.")}catch{u("Your profile could not be saved. Try again.",{tone:"error"})}finally{_(!1)}};return l.jsxs("article",{className:"mx-auto max-w-2xl",children:[l.jsx("h1",{className:"font-heading text-h1 font-semibold text-text-primary",children:i?"Complete your profile":"Your profile"}),l.jsx("p",{className:"mt-xs max-w-prose text-body text-text-secondary",children:"This is what other attendees see about you. Everything except your name is optional."}),l.jsxs("form",{className:"mt-xl space-y-lg",onSubmit:j,noValidate:!0,children:[l.jsx(pn,{uid:e.uid,value:a.photoPath,onChange:c=>g("photoPath",c)}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"displayName",className:"block font-semibold text-text-primary",children:"Name"}),l.jsx("input",{id:"displayName",ref:k,className:`mt-2xs ${D}`,value:a.displayName,onChange:c=>g("displayName",c.target.value),"aria-invalid":m?"true":void 0,"aria-describedby":m?"displayName-error":void 0,autoComplete:"name"}),m?l.jsx("p",{id:"displayName-error",role:"alert",className:"mt-2xs font-data text-caption text-danger",children:m}):null]}),l.jsxs("div",{className:"grid gap-lg sm:grid-cols-2",children:[l.jsxs("div",{children:[l.jsx("label",{htmlFor:"pronouns",className:"block font-semibold text-text-primary",children:"Pronouns"}),l.jsx("input",{id:"pronouns",className:`mt-2xs ${D}`,value:a.pronouns,onChange:c=>g("pronouns",c.target.value)})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"jobTitle",className:"block font-semibold text-text-primary",children:"Role"}),l.jsx("input",{id:"jobTitle",className:`mt-2xs ${D}`,value:a.jobTitle,onChange:c=>g("jobTitle",c.target.value),autoComplete:"organization-title"})]})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"organization",className:"block font-semibold text-text-primary",children:"Organization"}),l.jsx("input",{id:"organization",className:`mt-2xs ${D}`,value:a.organization,onChange:c=>g("organization",c.target.value),autoComplete:"organization"})]}),l.jsxs("div",{children:[l.jsx("label",{htmlFor:"bio",className:"block font-semibold text-text-primary",children:"About you"}),l.jsx("textarea",{id:"bio",rows:4,className:`mt-2xs ${D}`,value:a.bio,onChange:c=>g("bio",c.target.value)})]}),l.jsxs("fieldset",{children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:"Who can see your profile"}),l.jsx("div",{className:"mt-xs space-y-xs",children:b.map(c=>l.jsx(Xe,{name:"profileVisibility",value:c,label:ae[c].label,description:ae[c].description,checked:a.profileVisibility===c,onChange:()=>g("profileVisibility",c)},c))})]}),A.length>0?l.jsxs("section",{className:"mt-xl",children:[l.jsx(We,{level:2,title:"Badges"}),O?l.jsxs("p",{className:"mt-sm font-data text-caption text-text-secondary",role:"status",children:["This event is close to the platform’s ",te.MAX_TOTAL_BADGES,"-badge total across all categories, so some categories may offer fewer picks than usual."]}):null,A.map(c=>{const w=c.badges.filter(v=>a.badges.includes(v.id)).length,y=c.maxPicks!=null&&w>=c.maxPicks;return l.jsxs("fieldset",{className:"mt-md",children:[l.jsx("legend",{className:"font-semibold text-text-primary",children:c.label}),c.maxPicks!=null?l.jsx("p",{className:"mt-2xs font-data text-caption text-text-secondary",role:"status",children:y?`You’ve picked all ${c.maxPicks} — clear one to choose another.`:`Pick up to ${c.maxPicks} (${w} chosen).`}):null,l.jsx("div",{className:"mt-xs grid gap-xs sm:grid-cols-2",children:c.badges.map(v=>{const H=a.badges.includes(v.id);return l.jsx(Ye,{label:v.label,checked:H,disabled:!H&&y,className:!H&&y?"text-text-secondary":"",onChange:()=>x(v.id)},v.id)})})]},c.id)})]}):null,l.jsx("button",{type:"submit",className:ee,disabled:d,children:d?"Saving…":"Save profile"})]})]})}export{xn as default};
