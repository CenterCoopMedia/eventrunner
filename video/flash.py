"""Native-pixel flash screening for SDR sRGB media; not a WCAG certification.

Tracks cumulative transitions, not frame differences. Tests both recurring
pixels and spatial transition episodes, so a moving flash cannot evade the
screen merely by moving to a new location. Opposite spatial cohorts accumulate independently and are paired only after
their combined area qualifies; an unrelated pixel cannot discard a cohort. A monotone wipe has disjoint same-direction
masks and is one episode, not one flash per decoded frame.

The 2% full-frame area limit is stricter than 25% of the conventional one-third
width by one-third height reference field. General threshold: 0.1 linear light
with a darker endpoint below 0.8. Red screening retains saturated-pixel history,
uses conservative u'/v' component thresholds 0.2/sqrt(2), and retains the older
linear-red excursion test as an additional conservative screen. These screens
can reject safe material (including later non-red motion at formerly red pixels); they are not a substitute for a recognized analyzer
when making a formal conformance claim.
"""
import argparse,json,subprocess,sys
from collections import deque
import numpy as np

AREA=.02

class Channel:
 def __init__(self,first,threshold,tags=None):
  self.low=first.copy();self.high=first.copy();self.direction=np.zeros(first.shape,np.int8);self.threshold=threshold
  self.low_tag=None if tags is None else tags.copy();self.high_tag=None if tags is None else tags.copy()
 def push(self,value,tags=None,general=False):
  lower=value<self.low;higher=value>self.high
  self.low=np.minimum(self.low,value);self.high=np.maximum(self.high,value)
  if tags is not None:
   self.low_tag[lower]=tags[lower];self.high_tag[higher]=tags[higher]
   up_eligible=self.low_tag|tags;down_eligible=self.high_tag|tags
  elif general:up_eligible=self.low<.8;down_eligible=value<.8
  else:up_eligible=down_eligible=True
  up=(value-self.low>=self.threshold)&(self.direction!=1)&up_eligible
  down=(self.high-value>=self.threshold)&(self.direction!=-1)&down_eligible
  self.direction[up]=1;self.direction[down]=-1
  self.high[up]=value[up];self.low[down]=value[down]
  if tags is not None:self.high_tag[up]=tags[up];self.low_tag[down]=tags[down]
  return up,down

class Episodes:
 """Accumulate rising and falling cohorts independently before pairing them.

 A tiny unrelated opposite pixel cannot clear a larger unfinished transition.
 Same-direction portions of a return sweep stay one transition, including when
 the rest of that sweep completes after a pair was first recognized.
 """
 def __init__(self,fps):
  self.fps=fps;self.masks=None;self.ready=[None,None];self.events=deque();self.worst=0;self.ambiguous=[];self.last_sign=0
 def push(self,up,down,index):
  while self.events and self.events[0]<=index-self.fps:self.events.popleft()
  if self.masks is None:self.masks=[np.zeros(up.shape,bool),np.zeros(up.shape,bool)]
  for i,mask in enumerate((up,down)):
   self.masks[i]|=mask
   if self.ready[i] is None and np.count_nonzero(self.masks[i])/mask.size>=AREA:self.ready[i]=index
  if all(t is not None for t in self.ready):
   first,second=self.ready
   if first==second:
    self.ambiguous.append(index)
    sign=-self.last_sign if self.last_sign else 1
    ordered=[(first,sign),(second,-sign)]
   else:ordered=sorted([(first,1),(second,-1)])
   for frame,sign in ordered:
    if sign!=self.last_sign:
     if frame>index-self.fps:self.events.append(frame)
     self.last_sign=sign
   for mask in self.masks:mask.fill(False)
   self.ready=[None,None]
  self.worst=max(self.worst,len(self.events))

class Analyzer:
 def __init__(self,fps):
  self.fps=fps;self.index=0;self.previous=None;self.channels=None;self.history=deque();self.count_g=None;self.count_r=None
  self.seen_saturated=None;self.general_episodes=Episodes(fps);self.red_episodes=Episodes(fps);self.worst_g=0;self.worst_r=0;self.max_area=0;self.hazards=[]
 def push(self,rgb):
  while self.history and self.history[0][0]<=self.index-self.fps:
   _,g,r=self.history.popleft();self.count_g-=np.unpackbits(g,count=self.count_g.size).reshape(self.count_g.shape);self.count_r-=np.unpackbits(r,count=self.count_r.size).reshape(self.count_r.shape)
  same=self.previous is not None and np.array_equal(rgb,self.previous)
  if same:
   blank=np.zeros(rgb.shape[:2],bool);self.general_episodes.push(blank,blank,self.index);self.red_episodes.push(blank,blank,self.index);self.index+=1;return
  self.previous=rgb.copy();srgb=rgb.astype(np.float32)/255
  linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
  rr,gg,bb=linear[:,:,0],linear[:,:,1],linear[:,:,2]
  lum=rr*.2126+gg*.7152+bb*.0722;sat=rr/np.maximum(rr+gg+bb,.00001)>=.8
  X=rr*.4124564+gg*.3575761+bb*.1804375;Y=rr*.2126729+gg*.7151522+bb*.0721750;Z=rr*.0193339+gg*.1191920+bb*.9503041
  den=np.maximum(X+15*Y+3*Z,.0000001);u=4*X/den;v=9*Y/den;red=np.maximum(0,rr-gg-bb)*320
  if self.channels is None:
   self.channels=(Channel(lum,.1),Channel(u,.2/np.sqrt(2),sat),Channel(v,.2/np.sqrt(2),sat),Channel(red,20,sat))
   self.seen_saturated=sat.copy();self.count_g=np.zeros(lum.shape,np.uint8);self.count_r=np.zeros(lum.shape,np.uint8);self.index+=1;return
  g_up,g_down=self.channels[0].push(lum,general=True);g=g_up|g_down
  r=np.zeros(lum.shape,bool)
  self.seen_saturated|=sat
  for ch,val in zip(self.channels[1:],(u,v,red)):
   up,down=ch.push(val,self.seen_saturated);r|=up|down
  self.count_g+=g;self.count_r+=r;self.history.append((self.index,np.packbits(g),np.packbits(r)))
  self.worst_g=max(self.worst_g,int(self.count_g.max()));self.worst_r=max(self.worst_r,int(self.count_r.max()))
  area=float(np.count_nonzero((self.count_g>6)|(self.count_r>6))/lum.size);self.max_area=max(self.max_area,area)
  if area>=AREA:self.hazards.append({'frame':self.index,'areaFraction':round(area,6)})
  self.general_episodes.push(g_up,g_down,self.index)
  self.red_episodes.push(r&sat,r&~sat,self.index)
  self.index+=1
 def report(self):
  ambiguous=sorted(set(self.general_episodes.ambiguous+self.red_episodes.ambiguous))
  passed=not self.hazards and self.general_episodes.worst<=6 and self.red_episodes.worst<=6
  return {'pass':passed,'status':'pass-screen' if passed else 'needs-review','certification':False,'frames':self.index,'fps':self.fps,'maxGeneralPixelTransitionsInOneSecond':self.worst_g,'maxRedPixelTransitionsInOneSecond':self.worst_r,'maxGeneralEpisodeTransitionsInOneSecond':self.general_episodes.worst,'maxRedEpisodeTransitionsInOneSecond':self.red_episodes.worst,'maxRapidPixelAreaFraction':round(self.max_area,6),'areaThreshold':AREA,'luminanceThreshold':.1,'redUVComponentThreshold':.2/np.sqrt(2),'legacyRedThreshold':20,'resolution':'native','ambiguousFrames':ambiguous,'hazardFrames':self.hazards,'method':'Cumulative native-pixel transitions plus paired spatial transition cohorts; >6 transitions per rolling second; rising/falling spatial cohorts accumulate independently before pairing. Conservative u/v and legacy red screens retain all saturation history (a deliberate overestimate). Not a conformance certificate.'}

def analyze(file):
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-of','json',file]))['streams'][0]
 w,h=probe['width'],probe['height'];num,den=map(int,probe['avg_frame_rate'].split('/'));fps=num/den
 p=subprocess.Popen(['ffmpeg','-v','error','-i',file,'-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24','-threads','1','-'],stdout=subprocess.PIPE)
 a=Analyzer(fps);size=w*h*3
 while True:
  buf=p.stdout.read(size)
  if not buf:break
  if len(buf)!=size:raise RuntimeError('Incomplete decoded frame')
  a.push(np.frombuffer(buf,np.uint8).reshape(h,w,3))
 p.stdout.close()
 if p.wait():raise RuntimeError('Decode failed')
 return a.report()|{'file':file,'width':w,'height':h}

def selftest():
 def sequence(fn,frames=90):
  a=Analyzer(30)
  for f in range(frames):a.push(fn(f))
  return a.report()
 solid=lambda v:np.full((96,128,3),v,np.uint8)
 color=lambda c:np.broadcast_to(np.array(c,np.uint8),(96,128,3)).copy()
 def wipe(f):
  if f<5:return solid(0)
  if f<10:return solid(255)
  im=solid(255);im[:,:min(128,(f-9)*13)]=0;return im
 def moving_pulse(f):
  im=solid(0)
  if f%6<3:
   x=(f//6*24)%96;im[10:50,x:x+32]=255
  return im
 def gradual_pulse(f):
  im=np.zeros((100,100,3),np.uint8)
  if f:
   f-=1;x=30+(f//6%3)*10;height=[10,20,30,20,10,0][f%6];im[30:30+height,x:x+10]=255
  return im
 def noisy_gradual(f):
  im=gradual_pulse(f);im[0,0]=255 if (f+1)%2==0 else 0;return im
 def noisy_gradual_other_phase(f):
  im=gradual_pulse(f);im[0,0]=255 if f%2==0 else 0;return im
 def small_moving_patch(f):
  im=np.zeros((100,100,3),np.uint8)
  if f:
   x,y=[(30,30),(45,30),(30,50),(45,50)][((f-1)//3)%4];im[y:y+10,x:x+15]=255
  return im
 def alternating(f):
  im=solid(0);x=(f//3%2)*64;im[:,x:x+48]=255;return im
 red_cycle=[[0,48,0],[89,0,0],[89,48,0],[32,48,0],[0,48,0],[0,48,0]]
 cases={
 'still':(lambda f:solid(160),True),
 'one_hz':(lambda f:solid(0 if f%30<15 else 255),True),
 'five_hz':(lambda f:solid(0 if f%6<3 else 255),False),
 'four_hz':(lambda f:solid(0 if int(f*8/30)%2==0 else 255),False),
 'single_return_wipe':(wipe,True),
 'slow_fade':(lambda f:solid(int(f/89*255)),True),
 'cumulative_flash':(lambda f:solid([0,64,128,192,255,192,128,64][f%8]),False),
 'saturated_red':(lambda f:color([255,0,0] if f%6<3 else [40,0,0]),False),
 'linear_red':(lambda f:color([128,30,30] if f%6<3 else [128,70,70]),False),
 'cumulative_red':(lambda f:color(red_cycle[f%6]),False),
 'red_anchor_retention':(lambda f:color([[64,29,0],[32,32,0],[0,0,64],[0,0,64],[0,0,64],[0,0,64]][f%6]),False),
 'gradual_moving_pulses':(gradual_pulse,False),
 'gradual_pulses_with_unrelated_blink':(noisy_gradual,False),
 'gradual_pulses_other_blink_phase':(noisy_gradual_other_phase,False),
 'four_position_small_patch':(small_moving_patch,False),
 'moving_patch':(moving_pulse,False),
 'alternating_regions':(alternating,False),
 'moving_detail':(lambda f:np.stack([(((np.arange(128)[None,:]+f*20)//20+np.arange(96)[:,None]//20)%2)*255]*3,axis=2).astype(np.uint8),False),
 'small_cursor':(lambda f:np.pad(np.full((4,4,3),255 if f%6<3 else 0,np.uint8),((30,62),(30,94),(0,0))),True),
 }
 for phase in range(10):cases['three_hz_phase_'+str(phase)]=(lambda f,p=phase:solid(0 if (f+p)%10<5 else 255),True)
 results={}
 for name,(fn,expected)in cases.items():
  r=sequence(fn);assert r['pass']==expected,(name,r);results[name]={'pass':r['pass'],'expected':expected}
 # Holds still expire the rolling history, rather than freezing an old hazard.
 a=Analyzer(30)
 for f in range(100):a.push(solid(255 if f<30 and f%6<3 else 0))
 assert not a.history and not a.count_g.any() and not a.count_r.any()
 results['repeated_frame_expiry']={'pass':True,'expected':True}
 print(json.dumps(results,indent=2))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('file',nargs='?');parser.add_argument('--self-test',action='store_true');parser.add_argument('--output');args=parser.parse_args()
 if args.self_test:selftest()
 else:
  report=analyze(args.file);text=json.dumps(report,indent=2)
  if args.output:open(args.output,'w').write(text+'\n')
  print(text);sys.exit(0 if report['pass'] else 1)
