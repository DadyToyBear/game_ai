package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import fi.iki.elonen.NanoHTTPD;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Read-only HTTP access to a user-selected document tree. No FTP protocol or TLS. */
final class WebFilesServer extends NanoHTTPD {
    private final ContentResolver resolver;
    private final Uri tree;
    private final String credentials;
    private final DavAccess dav;
    private final Map<String, Item> items = new ConcurrentHashMap<>();
    private final Map<String, String> tokens = new ConcurrentHashMap<>();
    private static final class Item {
        final Uri uri; final boolean directory;
        Item(Uri uri, boolean directory) { this.uri=uri; this.directory=directory; }
    }
    WebFilesServer(ContentResolver resolver, Uri tree, int port, String user, String password, boolean anonymous, boolean allowWrites, java.io.File cache) {
        super(port);
        this.resolver=resolver; this.tree=tree; this.dav=new DavAccess(resolver,tree,cache,allowWrites && !anonymous);
        credentials=anonymous ? null : "Basic " + Base64.encodeToString((user+":"+password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        items.put("root", new Item(DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)), true));
    }
    @Override public Response serve(IHTTPSession session) {
        Response response=serveRequest(session);
        // Request bodies (including PROPFIND) are ignored; close rather than reuse the socket.
        response.addHeader("Connection", "close");
        return response;
    }
    private Response serveRequest(IHTTPSession session) {
        if(credentials != null && !MessageDigest.isEqual(credentials.getBytes(StandardCharsets.UTF_8), session.getHeaders().getOrDefault("authorization", "").getBytes(StandardCharsets.UTF_8))) {
            Response response=newFixedLengthResponse(Response.Status.UNAUTHORIZED,"text/plain; charset=utf-8","Требуется вход");
            response.addHeader("WWW-Authenticate", "Basic realm=\"Aurora Files\""); return response;
        }
        if(session.getUri().equals("/dav") || session.getUri().startsWith("/dav/")) return dav.serve(session);
        if(session.getMethod()!=Method.GET) return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED,"text/plain","Read only");
        String path=session.getUri(); String key=path.equals("/") ? "root" : path.startsWith("/item/") ? path.substring(6) : "";
        Item item=items.get(key);
        if(item==null) return newFixedLengthResponse(Response.Status.NOT_FOUND,"text/plain","Not found");
        try {
            if(!item.directory) {
                InputStream in=resolver.openInputStream(item.uri);
                if(in==null) throw new java.io.IOException("Cannot open document");
                Response r=newChunkedResponse(Response.Status.OK,"application/octet-stream",in);
                r.addHeader("Content-Disposition","attachment"); r.addHeader("X-Content-Type-Options","nosniff"); return r;
            }
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(item.uri));
            StringBuilder html=new StringBuilder("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Aurora Files</title></head><body><h1>Aurora Files</h1><p><a href=\"/\">Корневая папка</a></p><ul>");
            try(Cursor c=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
                if(c==null) throw new java.io.IOException("Cannot list folder");
                while(c.moveToNext()) {
                    if(items.size() >= 10000 && !tokens.containsKey(c.getString(0))) continue;
                    String documentId=c.getString(0);
                    String token=tokens.computeIfAbsent(documentId, ignored -> UUID.randomUUID().toString());
                    Uri uri=DocumentsContract.buildDocumentUriUsingTree(tree,documentId);
                    boolean dir=DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2));
                    items.put(token,new Item(uri,dir));
                    html.append("<li><a href=\"/item/").append(token).append("\">").append(dir?"📁 ":"📄 ").append(escape(c.getString(1))).append("</a></li>");
                }
            }
            html.append("</ul></body></html>");
            Response r=newFixedLengthResponse(Response.Status.OK,"text/html; charset=utf-8",html.toString());
            r.addHeader("Content-Security-Policy","default-src 'none'; base-uri 'none'; form-action 'none'"); r.addHeader("X-Content-Type-Options","nosniff"); return r;
        } catch(Exception e) { return newFixedLengthResponse(Response.Status.INTERNAL_ERROR,"text/plain; charset=utf-8","Файл или папка недоступны"); }
    }
    private static String escape(String s) { return s==null?"Без имени":s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;"); }
}
