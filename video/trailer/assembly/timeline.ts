// 112 BPM: 21 bars in exactly 45 seconds. Picture and effects share these cues.
export const assemblyTimeline = {
 id:'general-trailer',title:'Make room for your event',fps:30,bpm:112,
 duration:1350,settle:1230,kind:'trailer' as const,seed:67041,
 periods:[242,578,854],silence:[1149,1157],
 assembly:{arrivals:[26,49,73,97],join:242,program:300,shape:386,
  styleFlow:[462,494,526],themePublish:578,gather:643,
  bookmarks:[710,807],reveal:964,title:1157,settle:1230},
 scenes:[
  {id:'parts',start:0,end:129,caption:'Every event starts with people.',capture:''},
  {id:'plan',start:129,end:386,caption:'Bring the pieces together.',capture:''},
  {id:'shape',start:386,end:643,caption:'Make it feel like your event.',capture:''},
  {id:'gather',start:643,end:964,caption:'A whole program. A personal day.',capture:''},
  {id:'reveal-experience',start:964,end:1157,caption:'One connected experience.',capture:''},
  {id:'end',start:1157,end:1350,caption:'Make room for your event.',capture:'',endCard:true}
 ]
};
