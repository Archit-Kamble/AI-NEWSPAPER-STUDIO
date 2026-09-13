# For each text line in a box: headstroke row (densest), baseline (where the
# consonant body ends), stroke weight (headstroke thickness) and the implied
# em at the Devanagari shirorekha ratio 0.625. Also horizontal ink colour.
import sys
from PIL import Image
from statistics import median
name=sys.argv[1]; boxes=sys.argv[2:]
im=Image.open(name+'.jpg').convert('RGB'); g=im.convert('L')
for spec in boxes:
    label,b=spec.split('|'); x0,y0,x1,y1=map(int,b.split(','))
    crop=g.crop((x0,y0,x1,y1)); w,h=crop.size
    ink=crop.point(lambda v:255 if v<150 else 0)
    p=[v/255 for v in ink.resize((1,h),Image.BOX).getdata()]
    # split lines on rows with ~no ink
    lines=[];s=None
    for i,v in enumerate(p+[0]):
        if v>0.01 and s is None: s=i
        if v<=0.01 and s is not None:
            if i-s>=8: lines.append((s,i))
            s=None
    out=[]
    for a,c in lines:
        seg=p[a:c]; head=max(range(len(seg)),key=lambda i:seg[i])
        body=[v for v in seg[head+3:] ]
        if not body: continue
        m=median(body[:max(3,len(body)//2)])
        base=head+3
        while base<len(seg) and seg[base]>0.45*m: base+=1
        # stroke: rows around head above 0.6*max
        mx=seg[head]; t=head
        while t>0 and seg[t-1]>0.6*mx: t-=1
        bb=head
        while bb<len(seg)-1 and seg[bb+1]>0.6*mx: bb+=1
        xh=base-head
        out.append((y0+a,y0+c,xh,bb-t+1))
    ems=[round(o[2]/0.625,1) for o in out if o[2]>4]
    print(label,'lines',len(out),'line tops',[o[0] for o in out][:6],'xheights',[o[2] for o in out][:6],'em(scan)',ems[:6],'stroke',[o[3] for o in out][:6])
