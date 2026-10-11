export function requireVerifiedExport(report,digest,fileHash,analyzerHash){
 if(report.inputDigest!==digest)throw new Error('Verification does not cover current inputs');
 if(report.sha256!==fileHash||report.flash?.fileHash!==fileHash||!report.flash?.pass)throw new Error('Export requires the currently verified public MP4');
 if(report.flash.analyzerHash!==analyzerHash)throw new Error('Flash verification is stale; run verification with the current analyzer');
}
