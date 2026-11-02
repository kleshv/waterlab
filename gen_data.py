"""Собирает SQL для переноса всех данных из кабинета в Supabase.
Вход: папка экспорта (col/id.json). Выход: data_NN.sql частями до ~150 КБ."""
import json,glob,os,sys
src=sys.argv[1]; out=sys.argv[2] if len(sys.argv)>2 else '.'
rows=[]
for col in sorted(os.listdir(src)):
    for f in sorted(glob.glob(os.path.join(src,col,'*.json'))):
        rows.append((col,os.path.basename(f)[:-5],json.load(open(f))))
q=lambda s: "'"+s.replace("'","''")+"'"
parts=[];cur=[];size=0
for col,id,d in rows:
    v=f"({q(col)},{q(id)},{q(json.dumps(d,ensure_ascii=False))}::jsonb)"
    cur.append(v);size+=len(v)
    if size>140000: parts.append(cur);cur=[];size=0
if cur: parts.append(cur)
for i,p in enumerate(parts,1):
    open(os.path.join(out,f'data_{i:02d}.sql'),'w').write("insert into public.docs(col,id,data) values\n"+",\n".join(p)+"\non conflict (col,id) do update set data=excluded.data;\n")
print(len(rows),'rows in',len(parts),'files')
