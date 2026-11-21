package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import android.provider.DocumentsContract;
import java.util.*;

/** Bounded, cancellable search below a single SAF directory. */
final class FileSearch {
    static final int MAX_ITEMS=10000, MAX_DEPTH=32, MAX_RESULTS=100;
    enum Type { ALL, FILES, FOLDERS }
    static boolean matchesType(String mime,Type type){boolean directory=DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);return type==Type.ALL||(type==Type.FOLDERS?directory:!directory);}
    static final class Match {
        final Uri uri; final String name,mime,path; final long size; final List<Uri> ancestors;
        Match(Uri uri,String name,String mime,String path,long size,List<Uri> ancestors){this.uri=uri;this.name=name;this.mime=mime;this.path=path;this.size=size;this.ancestors=ancestors;}
    }
    static final class Result {final List<Match> matches=new ArrayList<>();int examined,inaccessible;boolean limited;}
    private static final class Folder {
        final String id,path;final int depth;final List<Uri> ancestors;
        Folder(String id,String path,int depth,List<Uri> ancestors){this.id=id;this.path=path;this.depth=depth;this.ancestors=ancestors;}
    }
    private final ContentResolver resolver;private final Uri tree,start;private final CancellationSignal cancel;
    FileSearch(ContentResolver resolver,Uri tree,Uri start,CancellationSignal cancel){this.resolver=resolver;this.tree=tree;this.start=start;this.cancel=cancel;}
    static boolean matches(String name,String query){return name!=null&&name.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT));}
    Result search(String query){return search(query,Type.ALL,true);}
    Result search(String query,Type type,boolean recursive){
        if(type==null)throw new IllegalArgumentException("Не указан тип");
        if(query==null||query.trim().isEmpty()||query.length()>256)throw new IllegalArgumentException("Введите от 1 до 256 символов");
        query=query.trim();Result result=new Result();Set<String> visited=new HashSet<>();ArrayDeque<Folder> queue=new ArrayDeque<>();
        String id=DocumentsContract.getDocumentId(start);visited.add(id);queue.add(new Folder(id,"",0,Collections.singletonList(start)));
        while(!queue.isEmpty()){
            cancel.throwIfCanceled();Folder folder=queue.removeFirst();Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,folder.id);
            try(Cursor c=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null,cancel)){
                if(c==null){result.inaccessible++;continue;}
                while(c.moveToNext()){
                    cancel.throwIfCanceled();if(result.examined>=MAX_ITEMS){result.limited=true;return result;}result.examined++;
                    String childId=c.getString(0),name=c.getString(1),mime=c.getString(2);if(childId==null||name==null){result.inaccessible++;continue;}
                    if(!visited.add(childId))continue;
                    Uri uri=DocumentsContract.buildDocumentUriUsingTree(tree,childId);String path=folder.path+name;
                    if(matches(name,query)&&matchesType(mime,type)){
                        result.matches.add(new Match(uri,name,mime,path,c.isNull(3)?-1:c.getLong(3),folder.ancestors));
                        if(result.matches.size()>=MAX_RESULTS){result.limited=true;return result;}
                    }
                    if(recursive&&DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)){
                        if(folder.depth+1>MAX_DEPTH){result.limited=true;continue;}
                        List<Uri> ancestors=new ArrayList<>(folder.ancestors);ancestors.add(uri);
                        queue.addLast(new Folder(childId,path+"/",folder.depth+1,ancestors));
                    }
                }
            }catch(OperationCanceledException e){throw e;}catch(Exception e){result.inaccessible++;}
        }
        return result;
    }
}
