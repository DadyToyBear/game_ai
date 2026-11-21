package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import android.provider.DocumentsContract;
import android.webkit.MimeTypeMap;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Bounded, cancellable scan of the selected SAF tree, not of the whole device. */
final class StorageScanner {
    static final int MAX_ITEMS = 10000, MAX_DEPTH = 32;
    static final String[] LABELS = {"Изображения", "Видео", "Аудио", "Документы", "Архивы", "Другие файлы"};
    static final class Result {
        final long[] sizes = new long[LABELS.length];
        long total; int files, folders, unknownSize, inaccessible; boolean limited;
    }
    private static final class Folder {
        final String id; final int depth;
        Folder(String id, int depth) { this.id=id; this.depth=depth; }
    }
    private final ContentResolver resolver;
    private final Uri tree;
    private final CancellationSignal cancellation;
    StorageScanner(ContentResolver resolver, Uri tree, CancellationSignal cancellation) {
        this.resolver=resolver; this.tree=tree; this.cancellation=cancellation;
    }
    Result scan() {
        Result result=new Result();
        ArrayDeque<Folder> pending=new ArrayDeque<>();
        Set<String> visited=new HashSet<>();
        String root=DocumentsContract.getTreeDocumentId(tree);
        pending.add(new Folder(root,0)); visited.add(root);
        int seen=0;
        while(!pending.isEmpty()) {
            cancellation.throwIfCanceled();
            Folder folder=pending.removeFirst();
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,folder.id);
            try(Cursor cursor=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null,cancellation)) {
                if(cursor==null) { result.inaccessible++; continue; }
                while(cursor.moveToNext()) {
                    cancellation.throwIfCanceled();
                    if(seen>=MAX_ITEMS){result.limited=true;return result;}
                    seen++;
                    String id=cursor.getString(0), name=cursor.getString(1), mime=cursor.getString(2);
                    if(id==null){result.inaccessible++;continue;}
                    // A provider can expose the same document more than once; count it only once.
                    if(!visited.add(id)) continue;
                    if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        result.folders++;
                        if(folder.depth+1>MAX_DEPTH) result.limited=true;
                        else pending.addLast(new Folder(id,folder.depth+1));
                    } else {
                        result.files++;
                        if(cursor.isNull(3)||cursor.getLong(3)<0){result.unknownSize++;continue;}
                        long size=cursor.getLong(3); int category=category(name,mime);
                        result.sizes[category]=saturatedAdd(result.sizes[category],size);
                        result.total=saturatedAdd(result.total,size);
                    }
                }
            } catch(OperationCanceledException e) { throw e; }
            catch(Exception e) { result.inaccessible++; }
        }
        return result;
    }
    private static long saturatedAdd(long a,long b){return Long.MAX_VALUE-a<b?Long.MAX_VALUE:a+b;}
    static int category(String name,String mime) {
        String n=name==null?"":name.toLowerCase(Locale.ROOT);
        String m=mime==null?"":mime.toLowerCase(Locale.ROOT);
        int dot=n.lastIndexOf('.'); String ext=dot<0?"":n.substring(dot+1);
        if(m.isEmpty()||m.equals("application/octet-stream")) {
            String guessed=MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if(guessed!=null)m=guessed;
        }
        if(m.startsWith("image/"))return 0;
        if(m.startsWith("video/"))return 1;
        if(m.startsWith("audio/"))return 2;
        if(m.contains("zip")||m.contains("rar")||m.contains("compressed")||ext.equals("7z")||ext.equals("tar")||ext.equals("gz"))return 4;
        if(m.startsWith("text/")||m.equals("application/pdf")||m.contains("document")||m.contains("spreadsheet")||m.contains("presentation")||ext.equals("json")||ext.equals("xml"))return 3;
        return 5;
    }
}
