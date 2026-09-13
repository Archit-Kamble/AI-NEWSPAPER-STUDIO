import sys
from PIL import Image
from collections import Counter
name=sys.argv[1]
im=Image.open(name+'.jpg').convert('RGB')
def mode(box, want='ground'):
    c=Counter()
    for (r,g,b) in im.crop(box).getdata():
        v=(r+g+b)/3; s=max(r,g,b)-min(r,g,b)
        if want=='ground' and v>150: c[(r//6*6,g//6*6,b//6*6)]+=1
        if want=='ink' and s>60: c[(r//8*8,g//8*8,b//8*8)]+=1
    if not c: return None
    (r,g,b),n=c.most_common(1)[0]
    return '#%02x%02x%02x'%(r+3,g+3,b+3), n
for spec in sys.argv[2:]:
    label,box,want=spec.split('|'); print(label, mode(tuple(map(int,box.split(','))),want))
