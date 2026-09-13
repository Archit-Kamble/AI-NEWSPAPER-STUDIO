import sys, json
from PIL import Image
name=sys.argv[1]; box=tuple(map(int,sys.argv[2].split(','))); minh=int(sys.argv[3]) if len(sys.argv)>3 else 14
g=Image.open(name+'.jpg').convert('L').crop(box)
ink=g.point(lambda v:255 if v<200 else 0)
p=[v for v in ink.resize((1,g.size[1]),Image.BOX).getdata()]
runs=[];s=None
for i,v in enumerate(p+[255]):
    if v==0 and s is None: s=i
    if v!=0 and s is not None:
        if i-s>=minh: runs.append((box[1]+s,box[1]+i))
        s=None
print('white bands (y0,y1):',runs)
