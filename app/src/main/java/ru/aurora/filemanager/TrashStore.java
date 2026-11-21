package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** A per-tree SAF recycle bin. No copy-and-delete fallback: only provider moves. */
final class TrashStore {
    private static final Object LOCK=new Object();
    private final ContentResolver resolver;private final AtomicFile file;
    static final class Record {
        final String id,name,state;final Uri moved;
        Record(JSONObject o)throws JSONException{id=o.getString("id");name=o.getString("name");state=o.getString("state");moved=o.has("moved")?Uri.parse(o.getString("moved")):null;}
    }
    static final class Snapshot {final Uri trash;final List<Record> records;Snapshot(Uri t,List<Record> r){trash=t;records=r;}}
    TrashStore(Context context){resolver=context.getContentResolver();file=new AtomicFile(new File(context.getFilesDir(),"aurora-trash.json"));}
    private JSONObject read() throws Exception {
        if(!file.getBaseFile().exists()&&!new File(file.getBaseFile().getPath()+".bak").exists())return new JSONObject().put("trees",new JSONObject()).put("records",new JSONArray());
        try(FileInputStream in=file.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>4*1024*1024)throw new IOException("Слишком много записей корзины");out.write(b,0,n);}
            JSONObject data=new JSONObject(out.toString("UTF-8"));data.getJSONObject("trees");data.getJSONArray("records");return data;
        }
    }
    private void write(JSONObject data) throws IOException {
        byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>4*1024*1024)throw new IOException("Слишком много записей корзины");
        FileOutputStream out=file.startWrite();try{out.write(bytes);file.finishWrite(out);}catch(Exception e){file.failWrite(out);throw new IOException("Не удалось сохранить записи корзины",e);}
    }
    private static Uri root(Uri tree){return DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));}
    private static boolean same(Uri a,Uri b){return a!=null&&b!=null&&a.getAuthority().equals(b.getAuthority())&&DocumentsContract.getDocumentId(a).equals(DocumentsContract.getDocumentId(b));}
    private JSONObject record(JSONObject data,String id,Uri tree) throws Exception {
        JSONArray records=data.getJSONArray("records");for(int i=0;i<records.length();i++){JSONObject r=records.getJSONObject(i);if(r.getString("id").equals(id)&&r.getString("tree").equals(tree.toString()))return r;}throw new IOException("Запись корзины не найдена");
    }
    private void remove(JSONObject data,String id) throws Exception {
        JSONArray old=data.getJSONArray("records"),remaining=new JSONArray();for(int i=0;i<old.length();i++){JSONObject r=old.getJSONObject(i);if(!r.getString("id").equals(id))remaining.put(r);}data.put("records",remaining);
    }
    private String name(Uri uri) throws IOException {
        try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(c==null||!c.moveToFirst()||c.isNull(0)||c.getString(0).isEmpty())throw new IOException("Объект недоступен");return c.getString(0);
        }
    }
    private void requireMove(Uri uri) throws IOException {
        try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_FLAGS},null,null,null)){
            if(c==null||!c.moveToFirst()||c.isNull(0)||(c.getLong(0)&DocumentsContract.Document.FLAG_SUPPORTS_MOVE)==0)throw new IOException("Провайдер не поддерживает перемещение в корзину");
        }
    }
    private void requireFreeName(Uri tree,Uri parent,String name) throws IOException {
        for(FileOperations.Item i:new FileOperations(resolver,tree).children(parent))if(i.name!=null&&name.equalsIgnoreCase(i.name))throw new IOException("Объект с таким именем уже существует в папке назначения");
    }
    private Uri trashFolder(JSONObject data,Uri tree,boolean create) throws Exception {
        JSONObject trees=data.getJSONObject("trees");String stored=trees.optString(tree.toString(),"");
        if(!stored.isEmpty()){
            Uri folder=Uri.parse(stored);name(folder);return folder; // Never silently replace a missing folder.
        }
        if(!create)return null;
        Uri folder=DocumentsContract.createDocument(resolver,root(tree),DocumentsContract.Document.MIME_TYPE_DIR,".AuroraFiles-Trash");
        if(folder==null)throw new IOException("Провайдер не позволяет создать папку корзины");
        trees.put(tree.toString(),folder.toString());write(data);return folder;
    }
    Snapshot list(Uri tree) throws Exception {synchronized(LOCK){
        JSONObject data=read();Uri trash=trashFolder(data,tree,false);List<Record> found=new ArrayList<>();JSONArray records=data.getJSONArray("records");
        for(int i=0;i<records.length();i++){JSONObject r=records.getJSONObject(i);if(r.getString("tree").equals(tree.toString()))found.add(new Record(r));}
        Collections.reverse(found);return new Snapshot(trash,found);
    }}
    void moveToTrash(Uri tree,Uri parent,Uri source) throws Exception {synchronized(LOCK){
        JSONObject data=read();requireMove(source);String original=name(source);Uri trash=trashFolder(data,tree,true);
        if(same(source,trash)||same(parent,trash)||same(source,root(tree)))throw new IOException("Нельзя перемещать папку корзины или её содержимое в саму корзину");
        // Give every item its own new, empty folder so duplicate names in the bin cannot collide.
        String id=UUID.randomUUID().toString(), containerName="item-"+id;
        requireFreeName(tree,trash,containerName);
        Uri container=DocumentsContract.createDocument(resolver,trash,DocumentsContract.Document.MIME_TYPE_DIR,containerName);
        if(container==null||same(container,trash)||!containerName.equals(name(container))||!new FileOperations(resolver,tree).children(container).isEmpty())
            throw new IOException("Не удалось создать пустую папку для элемента корзины");
        JSONObject r=new JSONObject().put("id",id).put("tree",tree.toString()).put("parent",parent.toString()).put("source",source.toString()).put("trash",container.toString()).put("name",original).put("state","moving");
        data.getJSONArray("records").put(r);write(data); // Durable before the provider moves the source.
        try{
            Uri moved=DocumentsContract.moveDocument(resolver,source,parent,container);if(moved==null)throw new IOException("Провайдер не подтвердил перемещение");
            r.put("moved",moved.toString()).put("state","ready");write(data);
        }catch(Exception ex){throw new IOException("Результат перемещения неизвестен. Проверьте исходную папку и папку корзины вручную; запись сохранена.",ex);}
    }}
    void restore(Uri tree,String id) throws Exception {synchronized(LOCK){
        JSONObject data=read(),r=record(data,id,tree);if(!"ready".equals(r.getString("state")))throw new IOException("Проверьте папки вручную: состояние операции неизвестно");
        Uri moved=Uri.parse(r.getString("moved")),parent=Uri.parse(r.getString("parent")),trash=Uri.parse(r.getString("trash"));String original=r.getString("name");
        if(!name(moved).equals(original))throw new IOException("Имя в корзине изменилось; восстановите вручную");requireMove(moved);name(parent);requireFreeName(tree,parent,original);
        r.put("state","restoring");write(data);
        try{Uri restored=DocumentsContract.moveDocument(resolver,moved,trash,parent);if(restored==null)throw new IOException("Провайдер не подтвердил восстановление");remove(data,id);write(data);}
        catch(Exception ex){throw new IOException("Результат восстановления неизвестен. Проверьте исходную папку и корзину вручную.",ex);}
    }}
    void deletePermanently(Uri tree,String id) throws Exception {synchronized(LOCK){
        JSONObject data=read(),r=record(data,id,tree);if(!"ready".equals(r.getString("state")))throw new IOException("Проверьте папку корзины вручную");
        Uri moved=Uri.parse(r.getString("moved"));r.put("state","deleting");write(data);
        try{if(!DocumentsContract.deleteDocument(resolver,moved))throw new IOException("Удаление не поддерживается");remove(data,id);write(data);}
        catch(Exception ex){throw new IOException("Результат удаления неизвестен. Проверьте корзину вручную.",ex);}
    }}
    void forget(Uri tree,String id) throws Exception {synchronized(LOCK){JSONObject data=read();record(data,id,tree);remove(data,id);write(data);}}
}
