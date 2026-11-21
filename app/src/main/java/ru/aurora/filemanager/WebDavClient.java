package ru.aurora.filemanager;

import android.app.Activity;
import android.net.Uri;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import android.util.Xml;
import org.xmlpull.v1.XmlPullParser;
import okhttp3.*;
import org.xml.sax.*;


/** WebDAV client: never forwards credentials to a redirect or another origin. */
final class WebDavClient {
    private static final long MAX_UPLOAD=256L*1024*1024, MAX_XML=4L*1024*1024;
    private static final OkHttpClient HTTP=new OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).writeTimeout(30,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
    static final class Connection {
        final URI root;final String user,password;
        Connection(URI root,String user,String password){this.root=root;this.user=user;this.password=password;}
    }
    static final class Item {
        final URI uri;final String name;final boolean directory;final long size;
        Item(URI uri,String name,boolean directory,long size){this.uri=uri;this.name=name;this.directory=directory;this.size=size;}
    }
    static final class Listing {final List<Item> items=new ArrayList<>();boolean truncated;}
    interface Task<T>{T run() throws Exception;}
    interface Result<T>{void done(T value,Exception error);}
    static <T> void execute(Activity activity,Task<T> task,Result<T> callback){
        new Thread(()->{T value=null;Exception failure=null;try{value=task.run();}catch(Exception ex){failure=ex;}T result=value;Exception error=failure;
            activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())callback.done(result,error);});},"webdav-client").start();
    }
    static Connection connection(String address,String user,String password,boolean anonymous) throws Exception {
        URI parsed=new URI(address);
        if(parsed.getRawPath()!=null && parsed.getRawPath().isEmpty() && parsed.getRawAuthority()!=null && parsed.getRawQuery()==null && parsed.getRawFragment()==null)parsed=new URI(parsed.toASCIIString()+"/");
        URI root=checkUri(parsed);
        if(!root.getRawPath().endsWith("/"))root=new URI(root.toASCIIString()+"/");
        if(!anonymous && (user.isEmpty()||user.contains(":")||password.isEmpty()))throw new IOException("Укажите логин без двоеточия и пароль");
        return new Connection(root,anonymous?null:user,anonymous?null:password);
    }
    private static URI checkUri(URI uri) throws IOException {
        if(!uri.isAbsolute()||uri.getHost()==null||!("http".equalsIgnoreCase(uri.getScheme())||"https".equalsIgnoreCase(uri.getScheme()))||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null)throw new IOException("Нужен полный HTTP(S) адрес без логина, запроса и фрагмента");
        String raw=uri.getRawPath(); if(raw==null||raw.isEmpty())throw new IOException("Адрес должен содержать путь, например /");
        String lower=raw.toLowerCase(Locale.ROOT);if(lower.contains("%2f")||lower.contains("%5c")||raw.contains("\\"))throw new IOException("Недопустимый путь URL");
        String path=uri.getPath();if(path==null||!path.startsWith("/")||path.indexOf('\0')>=0||path.contains("%"))throw new IOException("Недопустимый путь URL");
        for(String part:path.split("/",-1))if(part.equals(".")||part.equals(".."))throw new IOException("Недопустимый путь URL");
        return uri;
    }
    private static int port(URI u){return u.getPort()>=0?u.getPort():("https".equalsIgnoreCase(u.getScheme())?443:80);}
    private static boolean sameOrigin(URI a,URI b){return a.getScheme().equalsIgnoreCase(b.getScheme())&&a.getHost().equalsIgnoreCase(b.getHost())&&port(a)==port(b);}
    private static URI allowed(Connection c,URI uri) throws IOException {
        uri=checkUri(uri);String root=c.root.getPath(),path=uri.getPath();String withoutSlash=root.substring(0,root.length()-1);
        if(!sameOrigin(c.root,uri)||!(path.equals(withoutSlash)||path.startsWith(root)))throw new IOException("Ссылка за пределами выбранного сервера или папки");return uri;
    }
    static URI child(Connection c,URI parent,String name) throws Exception {
        allowed(c,parent);if(name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/")||name.contains("\\")||name.indexOf('\0')>=0||name.contains("%"))throw new IOException("Недопустимое имя");
        String base=parent.toASCIIString();if(!base.endsWith("/"))base+="/";
        return allowed(c,new URI(base+Uri.encode(name)));
    }
    private static Request.Builder request(Connection c,URI uri) throws IOException {
        allowed(c,uri);Request.Builder b=new Request.Builder().url(uri.toASCIIString());
        if(c.user!=null)b.header("Authorization",Credentials.basic(c.user,c.password,StandardCharsets.UTF_8));return b;
    }
    private static void success(Response response) throws IOException {
        if(!response.isSuccessful())throw new IOException("HTTP "+response.code()+(response.isRedirect()?"; перенаправления отключены":""));
    }
    static Listing list(Connection c,URI directory) throws Exception {
        String xml="<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>";
        Request req=request(c,directory).header("Depth","1").method("PROPFIND",RequestBody.create(MediaType.parse("application/xml; charset=utf-8"),xml.getBytes(StandardCharsets.UTF_8))).build();
        try(Response response=HTTP.newCall(req).execute()){
            success(response);if(response.code()!=207||response.body()==null)throw new IOException("Сервер не вернул WebDAV multistatus");
            Listing result=new Listing();XmlPullParser parser=Xml.newPullParser();
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES,true);
            // Without DTD processing, reject the declaration itself and every custom entity.
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL,false);
            Handler handler=new Handler(c,directory,result);
            try(InputStream limited=new LimitInputStream(response.body().byteStream(),MAX_XML)){
                parser.setInput(limited,null);
                try {
                    int event;
                    while((event=parser.nextToken())!=XmlPullParser.END_DOCUMENT){
                        if(event==XmlPullParser.DOCDECL)throw new IOException("DTD запрещён");
                        if(event==XmlPullParser.ENTITY_REF){String name=parser.getName();if(!Arrays.asList("amp","lt","gt","quot","apos").contains(name))throw new IOException("XML entity запрещён");}
                        if(event==XmlPullParser.START_TAG)handler.startElement(parser.getNamespace(),parser.getName());
                        else if(event==XmlPullParser.END_TAG)handler.endElement(parser.getNamespace(),parser.getName());
                        else if(event==XmlPullParser.TEXT||event==XmlPullParser.CDSECT||event==XmlPullParser.ENTITY_REF){String value=parser.getText();if(value!=null)handler.characters(value);}
                    }
                }catch(TooManyEntries stop){result.truncated=true;}
            }
            Collections.sort(result.items,(a,b)->{int d=Boolean.compare(b.directory,a.directory);return d==0?a.name.compareToIgnoreCase(b.name):d;});return result;
        }
    }
    private static final class TooManyEntries extends SAXException {}
    private static final class Handler {
        final Connection c;final URI directory;final Listing result;final StringBuilder text=new StringBuilder();
        String href,display,propName,propStatus;long size,propSize;boolean dir,propDir,inPropstat;boolean resource,propResourcePresent,resourceKnown;
        Handler(Connection c,URI directory,Listing result){this.c=c;this.directory=directory;this.result=result;}
        void startElement(String ns,String local) throws SAXException {
            if(!"DAV:".equals(ns))return;text.setLength(0);
            if(local.equals("response")){href=null;display=null;size=-1;dir=false;resourceKnown=false;}
            else if(local.equals("propstat")){inPropstat=true;propName=null;propStatus=null;propSize=-1;propDir=false;propResourcePresent=false;}
            else if(inPropstat&&local.equals("resourcetype")){resource=true;propResourcePresent=true;}
            else if(inPropstat&&resource&&local.equals("collection"))propDir=true;
        }
        void characters(String value) throws SAXException {if(text.length()+value.length()>8192)throw new SAXException("Property too long");text.append(value); }
        void endElement(String ns,String local) throws SAXException {
            if(!"DAV:".equals(ns))return;String value=text.toString().trim();
            if(local.equals("href")&&!inPropstat&&href==null)href=value;
            else if(inPropstat&&local.equals("displayname"))propName=value;
            else if(inPropstat&&local.equals("getcontentlength")){try{propSize=Long.parseLong(value);if(propSize<0)propSize=-1;}catch(NumberFormatException ignored){propSize=-1;}}
            else if(inPropstat&&local.equals("status"))propStatus=value;
            else if(local.equals("resourcetype"))resource=false;
            else if(local.equals("propstat")){if(propStatus!=null&&propStatus.matches("HTTP/\\d(?:\\.\\d)? 200(?: .*)?")){if(propName!=null)display=propName;if(propSize>=0)size=propSize;if(propResourcePresent){dir=propDir;resourceKnown=true;}}inPropstat=false;}
            else if(local.equals("response")&&href!=null&&resourceKnown){
                try{
                    URI resolved=allowed(c,directory.resolve(new URI(href)));
                    String parent=directory.getPath();if(!parent.endsWith("/"))parent+="/";
                    String path=resolved.getPath();if(path.equals(directory.getPath())||path.equals(parent))return;
                    if(!path.startsWith(parent))return;String suffix=path.substring(parent.length());if(suffix.endsWith("/"))suffix=suffix.substring(0,suffix.length()-1);
                    if(suffix.isEmpty()||suffix.contains("/"))return;
                    if(result.items.size()>=1000)throw new TooManyEntries();
                    result.items.add(new Item(resolved,display==null||display.isEmpty()?suffix:display,dir,size));
                }catch(TooManyEntries stop){throw stop;}catch(Exception ignored){}
            }
            text.setLength(0);
        }
    }
    private static final class LimitInputStream extends FilterInputStream {
        long read,maximum;LimitInputStream(InputStream input,long maximum){super(input);this.maximum=maximum;}
        @Override public int read() throws IOException {int n=super.read();if(n>=0&&++read>maximum)throw new IOException("Ответ WebDAV слишком большой");return n;}
        @Override public int read(byte[] b,int o,int n)throws IOException{int k=super.read(b,o,n);if(k>0&&(read+=k)>maximum)throw new IOException("Ответ WebDAV слишком большой");return k;}
    }
    static void download(Activity activity,Connection c,URI remote,Uri local) throws Exception {
        Request req=request(c,remote).get().build();try(Response response=HTTP.newCall(req).execute()){
            success(response);if(response.body()==null)throw new IOException("Пустой ответ");
            try(InputStream in=response.body().byteStream();OutputStream out=activity.getContentResolver().openOutputStream(local,"wt")){if(out==null)throw new IOException("Локальный файл недоступен");copy(in,out,Long.MAX_VALUE);}
        }
    }
    static void upload(Activity activity,Connection c,URI remote,Uri local) throws Exception {
        File temp=File.createTempFile("webdav-upload-",".tmp",activity.getCacheDir());
        try {
            try(InputStream in=activity.getContentResolver().openInputStream(local);OutputStream out=new FileOutputStream(temp)){if(in==null)throw new IOException("Локальный файл недоступен");copy(in,out,MAX_UPLOAD);}
            Request req=request(c,remote).put(RequestBody.create(MediaType.parse("application/octet-stream"),temp)).build();
            try(Response response=HTTP.newCall(req).execute()){success(response);}
        }finally{temp.delete();}
    }
    private static void copy(InputStream in,OutputStream out,long max) throws IOException {byte[] b=new byte[32768];long size=0;int n;while((n=in.read(b))!=-1){if(n>max-size)throw new IOException("Файл превышает лимит 256 МиБ");size+=n;out.write(b,0,n);}}
}
