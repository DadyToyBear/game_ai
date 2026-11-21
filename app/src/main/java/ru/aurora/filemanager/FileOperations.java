package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.*;
import java.util.*;
import java.util.zip.*;

/** SAF operations. Never use archive entry paths as filesystem paths. */
final class FileOperations {
    private static final String DIR=DocumentsContract.Document.MIME_TYPE_DIR;
    private static final int MAX_ENTRIES=10000, MAX_DEPTH=32;
    private static final long MAX_UNPACKED=1024L*1024*1024;
    static class Item { final Uri uri; final String name,mime; Item(Uri u,String n,String m){uri=u;name=n;mime=m;} boolean dir(){return DIR.equals(mime);} }
    private final ContentResolver resolver; private final Uri tree;
    private int count; private long bytes;
    FileOperations(ContentResolver resolver,Uri tree){this.resolver=resolver;this.tree=tree;}
    Item info(Uri uri) throws IOException {
        try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
            if(c==null || !c.moveToFirst()) throw new IOException("Не удалось прочитать свойства файла");
            return new Item(uri,c.getString(0),c.getString(1));
        }
    }
    List<Item> children(Uri parent) throws IOException {
        List<Item> result=new ArrayList<>(); Uri uri=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));
        try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){
            if(c==null)throw new IOException("Не удалось прочитать папку");
            while(c.moveToNext()){if(result.size()>=MAX_ENTRIES)throw new IOException("Слишком много файлов");result.add(new Item(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)),c.getString(1),c.getString(2)));}
        } return result;
    }
    private static void valid(String name) throws IOException { if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/")||name.contains("\\")||name.indexOf('\0')>=0)throw new IOException("Недопустимое имя в архиве или папке"); }
    private void limit(int depth) throws IOException { if(depth>MAX_DEPTH || ++count>MAX_ENTRIES) throw new IOException("Превышено ограничение числа или глубины элементов"); }
    private Uri create(Uri parent,String mime,String name) throws IOException {
        valid(name); List<Item> before=children(parent); for(Item i:before) if(name.equals(i.name))throw new IOException("Уже существует: "+name);
        Uri u=DocumentsContract.createDocument(resolver,parent,mime==null?"application/octet-stream":mime,name);
        if(u==null)throw new IOException("Не удалось создать: "+name);
        ensureNewDocument(before,u);
        try { if(!name.equals(info(u).name))throw new IOException("Провайдер изменил имя: "+name); }
        catch(Exception ex){try{DocumentsContract.deleteDocument(resolver,u);}catch(Exception ignored){} if(ex instanceof IOException)throw (IOException)ex;throw new IOException(ex);}
        return u;
    }
    static void ensureNewDocument(List<Item> before,Uri created) throws IOException {
        for(Item item:before)if(item.uri.equals(created))throw new IOException("Провайдер вернул существующий файл; проверьте папку вручную");
    }
    /** Create only; never open an existing document for writing or delete a returned URI. */
    Item createEmptyText(Uri parent,String name) throws IOException {
        valid(name);List<Item> before=children(parent);for(Item item:before)if(name.equals(item.name))throw new IOException("Уже существует: "+name);
        Uri created=DocumentsContract.createDocument(resolver,parent,"text/plain",name);if(created==null)throw new IOException("Провайдер не создал файл");
        ensureNewDocument(before,created);
        try{return info(created);}catch(Exception ex){throw new IOException("Файл мог быть создан, но проверить его свойства не удалось; проверьте папку вручную",ex);}
    }
    static String textName(String name) throws IOException {
        valid(name);if(!name.toLowerCase(java.util.Locale.ROOT).endsWith(".txt"))name+=".txt";return name;
    }
    private InputStream in(Uri u) throws IOException {InputStream i=resolver.openInputStream(u);if(i==null)throw new IOException("Не удалось открыть файл");return i;}
    private OutputStream out(Uri u) throws IOException {OutputStream o=resolver.openOutputStream(u,"wt");if(o==null)throw new IOException("Не удалось записать файл");return o;}
    private void transfer(InputStream in,OutputStream out,boolean limitSize) throws IOException {byte[] buf=new byte[32768];int n;while((n=in.read(buf))!=-1){if(limitSize && (bytes+=n)>MAX_UNPACKED)throw new IOException("Архив превышает лимит распаковки 1 ГиБ");out.write(buf,0,n);}}
    void copy(Item source,Uri destination) throws IOException { copy(source,destination,0); }
    void copyAs(Item source,Uri destination,String name) throws IOException { copy(new Item(source.uri,name,source.mime),destination,0); }
    private void copy(Item source,Uri destination,int depth) throws IOException {
        limit(depth); Uri created=create(destination,source.dir()?DIR:source.mime,source.name);
        try { if(source.dir()){for(Item child:children(source.uri))copy(child,created,depth+1);} else try(InputStream i=in(source.uri);OutputStream o=out(created)){transfer(i,o,false);} }
        catch(Exception e){try{DocumentsContract.deleteDocument(resolver,created);}catch(Exception ignored){} if(e instanceof IOException)throw (IOException)e;throw new IOException(e);}
    }
    void zip(Item source,Uri destination,String name) throws IOException {
        Uri archive=create(destination,"application/zip",name);
        try(OutputStream o=out(archive);ZipOutputStream z=new ZipOutputStream(o)){zipEntry(z,source,"",0);}
        catch(Exception e){try{DocumentsContract.deleteDocument(resolver,archive);}catch(Exception ignored){} if(e instanceof IOException)throw (IOException)e;throw new IOException(e);}
    }
    static void validateZipSelection(List<Item> selected) throws IOException {
        if(selected==null||selected.isEmpty()||selected.size()>100)throw new IOException("Выберите от 1 до 100 элементов");
        Set<String> names=new HashSet<>();Set<Uri> uris=new HashSet<>();for(Item item:selected){if(item==null||item.uri==null)throw new IOException("Некорректный элемент");valid(item.name);if(!names.add(item.name)||!uris.add(item.uri))throw new IOException("Повторяющееся имя или элемент: "+item.name);}
    }
    void zipMany(List<Item> selection,Uri destination,String name) throws IOException {
        validateZipSelection(selection);List<Item> available=children(destination);Map<Uri,Item> byUri=new HashMap<>();for(Item item:available)byUri.put(item.uri,item);
        List<Item> resolved=new ArrayList<>();for(Item selected:selection){Item actual=byUri.get(selected.uri);if(actual==null)throw new IOException("Элемент больше не находится в папке: "+selected.name);resolved.add(actual);}
        validateZipSelection(resolved);Uri archive=create(destination,"application/zip",name);
        try(OutputStream o=out(archive);ZipOutputStream zip=new ZipOutputStream(o)){for(Item item:resolved)zipEntry(zip,item,"",0);}
        catch(Exception ex){try{DocumentsContract.deleteDocument(resolver,archive);}catch(Exception ignored){}if(ex instanceof IOException)throw (IOException)ex;throw new IOException(ex);}
    }
    private void zipEntry(ZipOutputStream z,Item item,String prefix,int depth) throws IOException {
        limit(depth);valid(item.name);String name=prefix+item.name+(item.dir()?"/":"");z.putNextEntry(new ZipEntry(name));
        if(!item.dir())try(InputStream i=in(item.uri)){transfer(i,z,false);}z.closeEntry();
        if(item.dir())for(Item child:children(item.uri))zipEntry(z,child,name,depth+1);
    }
    void unzip(Item archive,Uri destination,String folderName) throws IOException {
        Uri root=create(destination,DIR,folderName); Map<String,Uri> dirs=new HashMap<>();dirs.put("",root); Set<String> files=new HashSet<>();
        try(InputStream input=in(archive.uri);ZipInputStream zip=new ZipInputStream(ZipHeader.checked(input,null))){
            ZipEntry e; while((e=zip.getNextEntry())!=null){limit(0);String name=e.getName();if(name.startsWith("/")||name.contains("\\"))throw new IOException("Небезопасный путь в архиве");
                String[] parts=name.split("/",-1);int length=parts.length;if(length>0&&parts[length-1].isEmpty())length--;if(length==0||length>MAX_DEPTH)throw new IOException("Недопустимый путь в архиве");
                Uri parent=root;String path="";for(int k=0;k<length;k++){valid(parts[k]);boolean dir=k<length-1||e.isDirectory();path+=parts[k];
                    if(dir){Uri next=dirs.get(path);if(next==null){next=create(parent,DIR,parts[k]);dirs.put(path,next);}parent=next;path+="/";}
                    else {if(!files.add(path))throw new IOException("Повторяющееся имя в архиве");Uri file=create(parent,"application/octet-stream",parts[k]);try(OutputStream o=out(file)){transfer(zip,o,true);}}
                }zip.closeEntry();
            }
        } catch(Exception e){try{DocumentsContract.deleteDocument(resolver,root);}catch(Exception ignored){} if(e instanceof IOException)throw (IOException)e;throw new IOException(e);}
    }
}
