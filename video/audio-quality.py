"""Inspect mastered PCM files without substituting for a listening review."""
import argparse, hashlib, json, wave
from pathlib import Path
import numpy as np

def inspect(file):
 with wave.open(str(file),'rb') as stream:
  rate,channels,bits=stream.getframerate(),stream.getnchannels(),stream.getsampwidth()*8
  samples=np.frombuffer(stream.readframes(stream.getnframes()),dtype='<i2').reshape(-1,channels).astype(np.float64)/32768
 record=json.loads(file.with_suffix('.json').read_text())
 clock=record['clock'];rms=lambda x:float(np.sqrt(np.mean(x*x)));db=lambda x:float(20*np.log10(max(x,1e-12)))
 mono=samples.mean(axis=1);stereo_rms=rms(samples)
 result={'file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'frames':len(samples),'sampleRate':rate,'bits':bits,'channels':channels,'samplePeakDbFS':db(np.max(np.abs(samples))),'dcOffsetDbFS':db(np.max(np.abs(samples.mean(axis=0)))),'stereoCorrelation':float(np.corrcoef(samples.T)[0,1]),'monoFoldDownLossDb':db(rms(mono)/stereo_rms),'firstSample':samples[0].tolist(),'lastSample':samples[-1].tolist(),'clippedSamples':int(np.sum(np.abs(samples)>=.9999))}
 if clock['silence']:
  start,end=(round(f/clock['fps']*rate) for f in clock['silence'])
  result['titleSilencePeakDbFS']=db(np.max(np.abs(samples[start:end])))
  result['silenceBoundaryJumpDbFS']=db(max(np.max(np.abs(samples[start]-samples[start-1])),np.max(np.abs(samples[end]-samples[end-1]))))
 result['pass']=rate==48000 and channels==2 and bits==16 and len(samples)==clock['duration']/clock['fps']*rate and result['clippedSamples']==0 and result['dcOffsetDbFS']<-50 and result['monoFoldDownLossDb']>-.8 and max(abs(samples[-1]))<.001 and result.get('titleSilencePeakDbFS',-120)<-70
 return result

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('root');args=parser.parse_args();root=Path(args.root)
 results=[inspect(file) for file in sorted((root/'assets/audio').glob('*.wav'))]
 (root/'review').mkdir(exist_ok=True);(root/'review/audio-quality.json').write_text(json.dumps(results,indent=2)+'\n')
 for result in results:print(result['file'], 'PASS' if result['pass'] else 'FAIL', 'mono loss',round(result['monoFoldDownLossDb'],3),'dB','DC',round(result['dcOffsetDbFS'],1),'dBFS')
 raise SystemExit(0 if all(r['pass'] for r in results) else 1)
