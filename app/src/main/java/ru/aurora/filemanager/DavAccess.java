package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import fi.iki.elonen.NanoHTTPD;
import java.io.*;
import android.webkit.MimeTypeMap;
import java.util.*;

/** WebDAV for the selected SAF tree; writes are opt-in and require authentication. */
final class DavAccess {
    private final ContentResolver resolver; private final Uri tree; private final Node root;
    private final File cache; private final boolean writes;
    private static final long MAX_UPLOAD=256L*1024*1024;
    private static final String DIR=DocumentsContract.Document.MIME_TYPE_DIR;
    private static class Node { Uri uri; String name,mime; long size; Node(Uri u,String n,String m,long s){uri=u;name=n;mime=m;size=s;} boolean dir(){return DIR.equals(mime);} }
    DavAccess(ContentResolver resolver,Uri tree,File cache,boolean writes){this.resolver=resolver;this.tree=tree;this.cache=cache;this.writes=writes;root=new Node(DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)),"Aurora Files",DIR,-1);}
    NanoHTTPD.Response serve(NanoHTTPD.IHTTPSession session) {
        NanoHTTPD.Method method=session.getMethod();
        if(method==NanoHTTPD.Method.OPTIONS){NanoHTTPD.Response r=NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK,"text/plain","");r.addHeader("DAV","1");r.addHeader("Allow",writes?"OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, MOVE, COPY":"OPTIONS, GET, HEAD, PROPFIND");return r;}
        if(method==NanoHTTPD.Method.PUT || method==NanoHTTPD.Method.MKCOL || method==NanoHTTPD.Method.DELETE || method==NanoHTTPD.Method.MOVE || method==NanoHTTPD.Method.COPY) {
            if(!writes)return response(NanoHTTPD.Response.Status.FORBIDDEN,"WebDAV writes disabled");
            return write(session);
        }
        if(method!=NanoHTTPD.Method.GET && method!=NanoHTTPD.Method.HEAD && method!=NanoHTTPD.Method.PROPFIND)return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED,"text/plain","Read only");
        try {
            String path=session.getUri();String rest=path.equals("/dav")?"":path.substring("/dav/".length());
            Node node=root;StringBuilder href=new StringBuilder("/dav/");
            if(!rest.isEmpty())for(String part:rest.split("/")){if(part.isEmpty())continue;if(part.equals(".")||part.equals("..")||!node.dir())return notFound();Node found=null;for(Node child:children(node)){if(part.equals(child.name)){if(found!=null)return notFound();found=child;}}if(found==null)return notFound();node=found;href.append(Uri.encode(part));if(node.dir())href.append('/');}
            if(method==NanoHTTPD.Method.PROPFIND){
                String depth=session.getHeaders().getOrDefault("depth","infinity");if(!depth.equals("0")&&!depth.equals("1"))return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.FORBIDDEN,"text/plain","Only Depth 0 and 1 supported");
                StringBuilder xml=new StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">");
                property(xml,node,href.toString()); if(depth.equals("1")&&node.dir())for(Node child:children(node))property(xml,child,href.toString()+Uri.encode(child.name)+(child.dir()?"/":""));
                xml.append("</d:multistatus>");return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.MULTI_STATUS,"application/xml; charset=utf-8",xml.toString());
            }
            if(node.dir())return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED,"text/plain","Use PROPFIND for directories");
            InputStream in=resolver.openInputStream(node.uri);if(in==null)throw new java.io.IOException("Cannot open file");
            NanoHTTPD.Response r=node.size>=0?NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK,node.mime,in,node.size):NanoHTTPD.newChunkedResponse(NanoHTTPD.Response.Status.OK,node.mime,in);
            r.addHeader("X-Content-Type-Options","nosniff");r.addHeader("Content-Disposition","attachment");return r;
        }catch(Exception e){return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.INTERNAL_ERROR,"text/plain; charset=utf-8","Документ недоступен");}
    }
    private static NanoHTTPD.Response response(NanoHTTPD.Response.Status status,String text){return NanoHTTPD.newFixedLengthResponse(status,"text/plain; charset=utf-8",text);}
    private Node child(Node parent,String name) throws Exception {
        Node found=null;for(Node item:children(parent))if(name.equals(item.name)){if(found!=null)throw new IOException("Duplicate name");found=item;}return found;
    }
    private static boolean validName(String name){return !name.isEmpty()&&!name.equals(".")&&!name.equals("..")&&!name.contains("\\")&&name.indexOf('\0')<0;}
    /** Serialize writes, so two uploads cannot create or overwrite the same resource concurrently. */
    private synchronized NanoHTTPD.Response write(NanoHTTPD.IHTTPSession session) {
        File temporary=null; Uri created=null;
        try {
            String path=session.getUri();String rest=path.equals("/dav")?"":path.substring("/dav/".length());
            if(rest.endsWith("/"))rest=rest.substring(0,rest.length()-1);
            if(rest.isEmpty())return response(NanoHTTPD.Response.Status.FORBIDDEN,"Cannot modify the shared root");
            String[] parts=rest.split("/",-1);if(parts.length>64)return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Path too deep");
            Node parent=root; for(int i=0;i<parts.length-1;i++){if(!validName(parts[i]))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid path");parent=child(parent,parts[i]);if(parent==null||!parent.dir())return response(NanoHTTPD.Response.Status.CONFLICT,"Parent not found");}
            String name=parts[parts.length-1];if(!validName(name))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid name");
            Node existing=child(parent,name); Map<String,String> headers=session.getHeaders();
            // Locks and arbitrary entity-tag conditions are not implemented. Never silently ignore them.
            if(headers.containsKey("if") || headers.containsKey("if-unmodified-since") || headers.containsKey("if-modified-since"))return response(NanoHTTPD.Response.Status.PRECONDITION_FAILED,"Conditional request not supported");
            String match=headers.get("if-match"), none=headers.get("if-none-match");
            if(match!=null && (!match.equals("*") || existing==null))return response(NanoHTTPD.Response.Status.PRECONDITION_FAILED,"If-Match failed");
            if(none!=null && (!none.equals("*") || existing!=null))return response(NanoHTTPD.Response.Status.PRECONDITION_FAILED,"If-None-Match failed");
            if(session.getMethod()==NanoHTTPD.Method.MOVE || session.getMethod()==NanoHTTPD.Method.COPY){
                if(existing==null)return notFound();
                return copyOrMove(session,existing);
            }
            if(session.getMethod()==NanoHTTPD.Method.DELETE){
                if(existing==null)return notFound();
                if(!DocumentsContract.deleteDocument(resolver,existing.uri))throw new IOException("Delete not supported");
                return response(NanoHTTPD.Response.Status.NO_CONTENT,"");
            }
            if(session.getMethod()==NanoHTTPD.Method.MKCOL){
                if(existing!=null)return response(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED,"Already exists");
                if(headers.containsKey("transfer-encoding") || (headers.containsKey("content-length") && !headers.get("content-length").equals("0")))return response(NanoHTTPD.Response.Status.UNSUPPORTED_MEDIA_TYPE,"MKCOL body not supported");
                created=DocumentsContract.createDocument(resolver,parent.uri,DIR,name);
                if(created==null)throw new IOException("Create folder not supported");
                if(!name.equals(actualName(created)))throw new IOException("Provider changed folder name");
                created=null;return response(NanoHTTPD.Response.Status.CREATED,"");
            }
            if(path.endsWith("/"))return response(NanoHTTPD.Response.Status.CONFLICT,"PUT requires a file path");
            if(headers.containsKey("expect"))return response(NanoHTTPD.Response.Status.EXPECTATION_FAILED,"Expect header not supported");
            if(existing!=null && existing.dir())return response(NanoHTTPD.Response.Status.CONFLICT,"Cannot overwrite a folder");
            if(headers.containsKey("content-range"))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Partial upload not supported");
            if(headers.containsKey("transfer-encoding"))return response(NanoHTTPD.Response.Status.NOT_IMPLEMENTED,"Chunked uploads not supported");
            String lengthHeader=headers.get("content-length");if(lengthHeader==null)return response(NanoHTTPD.Response.Status.LENGTH_REQUIRED,"Content-Length required");
            long length;try{length=Long.parseLong(lengthHeader);}catch(NumberFormatException e){return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid Content-Length");}
            if(length<0)return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid Content-Length");if(length>MAX_UPLOAD)return response(NanoHTTPD.Response.Status.PAYLOAD_TOO_LARGE,"Maximum 256 MiB");
            temporary=File.createTempFile("dav-upload-", ".tmp",cache);
            try(OutputStream out=new FileOutputStream(temporary)) {InputStream in=session.getInputStream();byte[] buffer=new byte[32768];long remaining=length;while(remaining>0){int n=in.read(buffer,0,(int)Math.min(remaining,buffer.length));if(n<0)throw new EOFException("Incomplete upload");if(n==0)throw new IOException("Upload stalled");out.write(buffer,0,n);remaining-=n;}}
            Uri target;
            if(existing==null){String ext=MimeTypeMap.getFileExtensionFromUrl(Uri.encode(name));String mime=MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.ROOT));created=DocumentsContract.createDocument(resolver,parent.uri,mime==null?"application/octet-stream":mime,name);if(created==null)throw new IOException("Create file not supported");if(!name.equals(actualName(created)))throw new IOException("Provider changed file name");target=created;}else target=existing.uri;
            // SAF offers no portable atomic replacement: a write failure can leave an existing file partial.
            try(InputStream in=new FileInputStream(temporary);OutputStream out=resolver.openOutputStream(target,"wt")){if(out==null)throw new IOException("Write not supported");byte[] buf=new byte[32768];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);}
            created=null;return response(existing==null?NanoHTTPD.Response.Status.CREATED:NanoHTTPD.Response.Status.NO_CONTENT,"");
        } catch(Exception e) {
            if(created!=null)try{DocumentsContract.deleteDocument(resolver,created);}catch(Exception ignored){}
            if(session.getMethod()==NanoHTTPD.Method.COPY || session.getMethod()==NanoHTTPD.Method.MOVE)
                return response(NanoHTTPD.Response.Status.INTERNAL_ERROR,"Copy failed; a partial destination may remain; source was not deleted");
            return response(NanoHTTPD.Response.Status.INTERNAL_ERROR,"Write failed; an existing file may have been partially changed");
        } finally {if(temporary!=null)temporary.delete();}
    }
    /** Destination must refer to this server and stay under the published tree. */
    private NanoHTTPD.Response copyOrMove(NanoHTTPD.IHTTPSession session,Node source) throws Exception {
        Map<String,String> headers=session.getHeaders(); String destination=headers.get("destination");
        if(destination==null)return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Destination required");
        java.net.URI url;
        try { url=new java.net.URI(destination); } catch(java.net.URISyntaxException e){return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid Destination");}
        String host=headers.get("host"); java.net.URI requestHost;
        try { requestHost=new java.net.URI("http://"+host); } catch(Exception e){return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid Host");}
        if(host==null || url.getUserInfo()!=null || url.getHost()==null || requestHost.getHost()==null || !"http".equalsIgnoreCase(url.getScheme()) || !url.getHost().equalsIgnoreCase(requestHost.getHost()) || effectivePort(url)!=effectivePort(requestHost) || url.getRawQuery()!=null || url.getRawFragment()!=null)
            return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Destination must be on this HTTP server");
        String raw=url.getRawPath(); if(raw==null || !(raw.equals("/dav")||raw.startsWith("/dav/")) || raw.toLowerCase(Locale.ROOT).contains("%2f"))return response(NanoHTTPD.Response.Status.FORBIDDEN,"Destination outside WebDAV tree");
        String decoded=Uri.decode(raw); String rest=decoded.equals("/dav")?"":decoded.substring(5);
        if(rest.endsWith("/"))rest=rest.substring(0,rest.length()-1);
        if(rest.isEmpty())return response(NanoHTTPD.Response.Status.FORBIDDEN,"Cannot replace shared root");
        String[] parts=rest.split("/",-1);if(parts.length>64)return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Path too deep");
        String overwrite=headers.getOrDefault("overwrite","T");if(!overwrite.equalsIgnoreCase("T")&&!overwrite.equalsIgnoreCase("F"))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid Overwrite header");
        String depth=headers.getOrDefault("depth","infinity");
        if(!depth.equalsIgnoreCase("infinity") && !(session.getMethod()==NanoHTTPD.Method.COPY && !source.dir() && depth.equals("0")))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Only recursive collection copies and moves are supported");
        if(headers.containsKey("transfer-encoding") || (headers.containsKey("content-length") && !headers.get("content-length").equals("0")))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Request body not supported");
        Node parent=root;
        if(source.dir() && sameDocument(source,parent))return response(NanoHTTPD.Response.Status.FORBIDDEN,"Destination is inside source");
        for(int i=0;i<parts.length-1;i++){
            if(!validName(parts[i]))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid destination");
            parent=child(parent,parts[i]);if(parent==null||!parent.dir())return response(NanoHTTPD.Response.Status.CONFLICT,"Destination parent missing");
            if(source.dir() && sameDocument(source,parent))return response(NanoHTTPD.Response.Status.FORBIDDEN,"Destination is inside source");
        }
        String name=parts[parts.length-1];if(!validName(name))return response(NanoHTTPD.Response.Status.BAD_REQUEST,"Invalid destination name");
        if(child(parent,name)!=null)return response(NanoHTTPD.Response.Status.PRECONDITION_FAILED,"Destination exists; overwriting is not supported");
        FileOperations ops=new FileOperations(resolver,tree);
        ops.copyAs(new FileOperations.Item(source.uri,source.name,source.mime),parent.uri,name);
        if(session.getMethod()==NanoHTTPD.Method.MOVE){
            try {if(!DocumentsContract.deleteDocument(resolver,source.uri))throw new IOException("Delete not supported");}
            catch(Exception e){return response(NanoHTTPD.Response.Status.INTERNAL_ERROR,"Copy created, but source could not be removed; check both locations");}
        }
        return response(NanoHTTPD.Response.Status.CREATED,"");
    }
    private static int effectivePort(java.net.URI uri){return uri.getPort()<0?80:uri.getPort();}
    private static boolean sameDocument(Node a,Node b){return DocumentsContract.getDocumentId(a.uri).equals(DocumentsContract.getDocumentId(b.uri));}
    private String actualName(Uri uri) throws IOException {
        try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(c==null||!c.moveToFirst())throw new IOException("Cannot read name");return c.getString(0);}
    }
    private List<Node> children(Node parent) throws Exception {
        ArrayList<Node> result=new ArrayList<>();Uri uri=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent.uri));
        try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)){
            if(c==null)throw new java.io.IOException("Cannot list directory");while(c.moveToNext()){if(result.size()>=10000)throw new java.io.IOException("Too many entries");String name=c.getString(1);if(name==null||name.isEmpty()||name.contains("/"))continue;result.add(new Node(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)),name,c.getString(2)==null?"application/octet-stream":c.getString(2),c.isNull(3)?-1:c.getLong(3)));}
        }return result;
    }
    private static String esc(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;");}
    private static void property(StringBuilder x,Node n,String href){x.append("<d:response><d:href>").append(esc(href)).append("</d:href><d:propstat><d:prop><d:displayname>").append(esc(n.name)).append("</d:displayname><d:resourcetype>");if(n.dir())x.append("<d:collection/>");x.append("</d:resourcetype>");if(!n.dir()){if(n.size>=0)x.append("<d:getcontentlength>").append(n.size).append("</d:getcontentlength>");x.append("<d:getcontenttype>").append(esc(n.mime)).append("</d:getcontenttype>");}x.append("</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");}
    private static NanoHTTPD.Response notFound(){return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.NOT_FOUND,"text/plain","Not found");}
}
