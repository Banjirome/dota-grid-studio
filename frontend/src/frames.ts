import {DotaCategory} from './model'

export type FrameStyle = 'filigree' | 'botanical' | 'lace' | 'thorn' | 'ribbon' | 'constellation' | 'brackets' | 'woven' | 'ink' | 'minimal'
export type ProceduralFrame = {id:string; name:string; x:number; y:number; width:number; height:number; style:FrameStyle; seed:number; density:number; depth:number; symmetry:boolean}
export const FRAME_STYLES: {id:FrameStyle; name:string}[] = [
  {id:'filigree',name:'Baroque crest'},{id:'botanical',name:'Floral rosette'},{id:'lace',name:'Layered lace'},{id:'thorn',name:'Gothic thorns'},{id:'ribbon',name:'Organic mantle'},
  {id:'constellation',name:'Constellation'},{id:'brackets',name:'Bracket ornament'},{id:'woven',name:'Woven border'},{id:'ink',name:'Ink silhouette'},{id:'minimal',name:'Minimal accents'},
]
type Mark={x:number;y:number;s:string}
const rnd=(seed:number)=>{let a=seed|0;return()=>{a|=0;a=a+0x6d2b79f5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const f=(n:number)=>Number(n.toFixed(3))

export function frameMarks(frame:ProceduralFrame):Mark[]{
  const r=rnd(frame.seed),out:Mark[]=[],occupied=new Set<string>()
  const w=Math.max(100,frame.width),h=Math.max(100,frame.height),margin=12
  const spacing=Math.max(9,17-frame.density*.65)
  const add=(x:number,y:number,s:string)=>{const key=`${Math.round(x/7)},${Math.round(y/7)}`;if(occupied.has(key))return;occupied.add(key);out.push({x,y,s})}
  const chars=(side:number,soft=false)=>{
    const horizontal=soft?['.',':','.', '-', '.', ':']:['.','/','\\',':','-','.']
    const vertical=soft?['.',':','|','.',':']:['|','/','\\',':','.','|']
    const pool=side%2===0?horizontal:vertical
    return pool[Math.floor(r()*pool.length)]
  }
  const point=(side:number,t:number,offset=0,wave=0)=>{
    const wobble=Math.sin(t*Math.PI*2*wave+frame.seed*.013)*offset*.28
    if(side===0)return{x:margin+t*(w-2*margin),y:margin+offset+wobble}
    if(side===1)return{x:w-margin-offset-wobble,y:margin+t*(h-2*margin)}
    if(side===2)return{x:w-margin-t*(w-2*margin),y:h-margin-offset-wobble}
    return{x:margin+offset+wobble,y:h-margin-t*(h-2*margin)}
  }
  const line=(side:number,offset:number,probability:number,wave=0,soft=false,gaps=0)=>{
    const length=side%2===0?w-2*margin:h-2*margin,n=Math.max(3,Math.floor(length/spacing))
    for(let i=0;i<=n;i++){const t=i/n;const gap=gaps>0&&Math.sin((t*gaps+frame.seed*.001)*Math.PI*2)>.68;if(gap||r()>probability)continue
      const p=point(side,t,offset+(r()-.5)*3,wave);add(p.x,p.y,chars(side,soft))}
  }
  const cloud=(side:number,centre:number,span:number,thickness:number,probability:number)=>{
    const length=side%2===0?w-2*margin:h-2*margin,n=Math.max(4,Math.floor(length/spacing))
    const lanes=Math.max(1,Math.floor(thickness/spacing))
    for(let lane=0;lane<lanes;lane++)for(let i=0;i<=n;i++){const t=i/n,d=Math.abs(t-centre)/(span/2);if(d>1||r()>probability*(1-d*.65))continue
      const p=point(side,t,lane*spacing+(r()-.5)*4,3);add(p.x,p.y,chars(side,r()<.48))}
  }
  const sprig=(side:number,t:number,direction=1)=>{
    const count=2+frame.depth
    for(let i=0;i<count;i++){
      const stem=point(side,t+(i-count/2)*spacing/(side%2===0?w:h),direction*(8+i*6),0)
      add(stem.x,stem.y,side%2===0?(i%2?'/':'\\'):(i%2?'(':')'))
      if(i%2===0){const leaf=point(side,t+(i-count/2)*spacing/(side%2===0?w:h),direction*(13+i*6),0);add(leaf.x,leaf.y,r()<.5?'(':')')}
    }
  }
  const field=(power:number,band:number,roughness:number,roundness:number,ornamental=false)=>{
    const phases=Array.from({length:7},(_,index)=>ornamental?(index%2)*Math.PI/2:r()*Math.PI*2)
    const harmonics=(a:number,inner=false)=>{
      let value=0
      for(let k=0;k<phases.length;k++){
        // Ornament contours must consist of many small intentional lobes. Low frequencies
        // deform the entire frame into an accidental asymmetric blob, so they are excluded.
        const frequency=ornamental?6+k*2:k+2
        const amplitude=(inner?.55:1)*roughness/Math.pow(frequency,roundness)
        value+=Math.sin(a*frequency+phases[k])*amplitude
      }
      return value
    }
    const cell=Math.max(8.5,14-frame.density*.45),hx=w/2-margin,hy=h/2-margin
    for(let y=margin;y<=h-margin;y+=cell)for(let x=margin;x<=w-margin;x+=cell){
      const nx=(x-w/2)/hx,ny=(y-h/2)/hy,a=Math.atan2(ny,nx)
      const q=Math.pow(Math.pow(Math.abs(nx),power)+Math.pow(Math.abs(ny),power),1/power)
      const outer=.93+harmonics(a)
      const inner=outer-band+harmonics(a,true)*.35
      if(q<inner||q>outer)continue
      const radial=(q-inner)/Math.max(.001,outer-inner)
      const probability=Math.min(.92,.34+frame.density*.045+(1-Math.abs(radial-.58)*2)*.18)
      if(r()>probability)continue
      const horizontal=Math.abs(ny)>Math.abs(nx)
      const lineChance=.16+frame.depth*.025+(radial>.72?.1:0)
      let s:string
      if(r()>lineChance)s=r()<.72?'.':':'
      else if(horizontal)s=r()<.42?'-':(nx*ny>0?'\\':'/')
      else s=r()<.42?'|':(nx*ny>0?'\\':'/')
      add(x+(r()-.5)*cell*.38,y+(r()-.5)*cell*.38,s)
    }
  }
  type Authored='baroque'|'floral'|'gothic'|'organic'|'ink'
  const authoredField=(kind:Authored)=>{
    const cell=Math.max(8.5,14-frame.density*.45),hx=w/2-margin,hy=h/2-margin
    const power=kind==='floral'?3.1:kind==='organic'?3.7:kind==='baroque'?7.5:kind==='gothic'?6.5:8
    const seedPhase=(frame.seed%997)/997*Math.PI*2
    const bump=(a:number,n:number,sharp=1)=>Math.pow(Math.max(0,Math.cos(a*n)),sharp)
    const contours=(a:number)=>{
      const depth=.015*frame.depth
      if(kind==='baroque')return{outer:.79+.055*Math.cos(4*a)+.14*bump(a+Math.PI/8,8,5)+.045*bump(a,16,7),inner:.62-depth+.012*Math.cos(8*a)}
      if(kind==='floral')return{outer:.79+.13*Math.cos(8*a)+.04*Math.cos(16*a),inner:.57-depth+.018*Math.cos(8*a)}
      if(kind==='gothic')return{outer:.76+.21*bump(a+Math.PI/16,8,9)+.045*Math.cos(16*a),inner:.61-depth+.012*Math.cos(8*a)}
      if(kind==='organic')return{outer:.8+.085*Math.cos(6*a)+.05*Math.cos(10*a)+.025*Math.cos(18*a),inner:.57-depth+.018*Math.cos(6*a)}
      return{outer:.875+.025*Math.cos(8*a)+.018*Math.cos(14*a+seedPhase)+.012*Math.cos(22*a-seedPhase),inner:.66-depth+.012*Math.cos(6*a)}
    }
    for(let y=margin;y<=h-margin;y+=cell)for(let x=margin;x<=w-margin;x+=cell){
      const nx=(x-w/2)/hx,ny=(y-h/2)/hy,a=Math.atan2(ny,nx)
      const q=Math.pow(Math.pow(Math.abs(nx),power)+Math.pow(Math.abs(ny),power),1/power)
      const {outer,inner}=contours(a);if(q<inner||q>outer)continue
      const radial=(q-inner)/(outer-inner),mass=.42+frame.density*.047+(1-Math.abs(radial-.55)*2)*.13
      if(r()>Math.min(.93,mass))continue
      const horizontal=Math.abs(ny)>Math.abs(nx),strokeChance=.12+frame.depth*.025+(radial>.76?.12:0)
      let s='.'
      if(r()<.24)s=':'
      if(r()<strokeChance)s=horizontal?(r()<.45?'-':nx*ny>0?'\\':'/'):(r()<.45?'|':nx*ny>0?'\\':'/')
      add(x+(r()-.5)*cell*.3,y+(r()-.5)*cell*.3,s)
    }
  }
  const motifFrame=(kind:'baroque'|'floral'|'gothic'|'braid')=>{
    const edge=46
    const at=(side:number,t:number,normal:number)=>{
      if(side===0)return{x:edge+t*(w-2*edge),y:edge+normal}
      if(side===1)return{x:w-edge-normal,y:edge+t*(h-2*edge)}
      if(side===2)return{x:w-edge-t*(w-2*edge),y:h-edge-normal}
      return{x:edge+normal,y:h-edge-t*(h-2*edge)}
    }
    const glyph=(side:number,dt:number,dn:number)=>{
      let dx=side%2===0?dt:(side===1?-dn:dn),dy=side%2===0?(side===0?dn:-dn):dt
      if(Math.abs(dx)>Math.abs(dy)*1.8)return '-';if(Math.abs(dy)>Math.abs(dx)*1.8)return '|';return dx*dy>0?'\\':'/'
    }
    const curve=(side:number,centre:number,span:number,normal:(u:number)=>number,soft=false)=>{
      const length=side%2===0?w-2*edge:h-2*edge,steps=Math.max(5,Math.floor(span*length/10));let previous:ReturnType<typeof at>|undefined
      for(let i=0;i<=steps;i++){const u=i/steps*2-1,t=centre+u*span/2;if(t<0||t>1)continue;const p=at(side,t,normal(u));if(previous){const s=soft?(i%3?'.':':'):glyph(side,p.x-previous.x,p.y-previous.y);add(p.x,p.y,s)}previous=p}
    }
    const parametric=(side:number,steps:number,fn:(v:number)=>{t:number;n:number},soft=false)=>{
      let previous:ReturnType<typeof at>|undefined
      for(let i=0;i<=steps;i++){const p0=fn(i/steps),p=at(side,p0.t,p0.n);if(previous)add(p.x,p.y,soft?(i%3?'.':':'):glyph(side,p.x-previous.x,p.y-previous.y));previous=p}
    }
    const leaf=(side:number,c:number,size:number,base:number,flip=1)=>{
      parametric(side,22,v=>{const a=v*Math.PI*2;return{t:c+Math.cos(a)*size,n:base+Math.sin(a)*size*(side%2===0?w:h)*flip*.8}},false)
      add(at(side,c,base).x,at(side,c,base).y,':')
    }
    const spiral=(side:number,c:number,base:number,flip=1)=>{
      parametric(side,22,v=>{const a=v*Math.PI*2.35,rad=(1-v)*22;return{t:c+Math.cos(a)*rad/(side%2===0?w:h),n:base+Math.sin(a)*rad*flip}},false)
    }
    const diamond=(side:number,c:number,size:number,base:number)=>{
      parametric(side,20,v=>{const q=v*4,segment=Math.min(3,Math.floor(q)),u=v===1?1:q-segment;const pts=[{t:c,n:base-size},{t:c+size/(side%2===0?w:h),n:base},{t:c,n:base+size},{t:c-size/(side%2===0?w:h),n:base},{t:c,n:base-size}],a=pts[segment],b=pts[segment+1];return{t:a.t+(b.t-a.t)*u,n:a.n+(b.n-a.n)*u}},false)
    }
    for(let side=0;side<4;side++){
      curve(side,.5,1,()=>18,true)
      if(kind==='braid'){
        curve(side,.5,1,u=>31+14*Math.sin(u*Math.PI*7),false);curve(side,.5,1,u=>31-14*Math.sin(u*Math.PI*7),false)
        for(const c of [.14,.32,.5,.68,.86])diamond(side,c,8,31)
      }else if(kind==='floral'){
        curve(side,.5,1,u=>29+5*Math.sin(u*Math.PI*5),false)
        for(const [i,c] of [.1,.3,.5,.7,.9].entries()){leaf(side,c,.06,31,i%2?1:-1);const p=at(side,c,52);add(p.x,p.y,i%2?'(':')')}
      }else if(kind==='gothic'){
        for(const [i,c] of [.09,.27,.5,.73,.91].entries()){
          const span=i===2?.24:.16,peak=i===2?42:27
          curve(side,c,span,u=>35-peak*Math.pow(1-Math.abs(u),2.7),false)
          curve(side,c,span,u=>38+9*(1-Math.abs(u)),true)
          diamond(side,c,i===2?11:7,39)
        }
      }else{
        spiral(side,.08,31,1);spiral(side,.92,31,-1)
        leaf(side,.23,.055,31,1);leaf(side,.77,.055,31,-1)
        curve(side,.5,.3,u=>32-38*Math.pow(1-Math.abs(u),2.2),false)
        curve(side,.5,.18,u=>37+15*Math.cos(u*Math.PI),false)
        diamond(side,.5,10,39)
      }
    }
  }

  switch(frame.style){
    case 'minimal': for(let s=0;s<4;s++){line(s,0,.72,0,true,3);cloud(s,.08,.16,12,.8);cloud(s,.92,.16,12,.8)} break
    case 'ink': authoredField('ink'); break
    case 'filigree': motifFrame('baroque'); break
    case 'botanical': motifFrame('floral'); break
    case 'lace': for(let s=0;s<4;s++){line(s,0,.88,0,true,0);line(s,spacing,.72,6,true,0);line(s,spacing*2,.45,6,true,4)} break
    case 'thorn': motifFrame('gothic'); break
    case 'ribbon': motifFrame('braid'); break
    case 'constellation': for(let s=0;s<4;s++){line(s,0,.42,1,true,4);line(s,spacing,.24,2,true,6);for(const t of [.08,.25,.5,.75,.92])cloud(s,t,.09,spacing*2,.65)} break
    case 'brackets': for(let s=0;s<4;s++){line(s,0,.76,0,true,5);for(const t of [.05,.25,.5,.75,.95])sprig(s,t,t<.5?1:-1)} break
    case 'woven': for(let s=0;s<4;s++){line(s,0,.82,9,false,0);line(s,spacing,.82,9,false,0);line(s,spacing*2,.38,4,true,3)} break
  }
  return out
}

export function frameCategories(frame:ProceduralFrame):DotaCategory[]{
  return frameMarks(frame).map(m=>({category_name:m.s,x_position:f(frame.x+m.x-8),y_position:f(frame.y+m.y-10),width:30,height:30,hero_ids:[]}))
}
