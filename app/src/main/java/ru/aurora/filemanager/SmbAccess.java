package ru.aurora.filemanager;

import android.app.Activity;
import android.net.Uri;
import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.msfscc.FileAttributes;
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.mssmb2.SMB2CreateOptions;
import com.hierynomus.mssmb2.SMB2Dialect;
import com.hierynomus.mssmb2.SMB2ShareAccess;
import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.SmbConfig;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.Directory;
import com.hierynomus.smbj.share.DiskShare;
import com.hierynomus.smbj.share.Share;
import java.io.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** SMB3 client, signed and encrypted only; no anonymous or SMB1/2 fallback. */
final class SmbAccess {
    static final class Credentials {
        final String host,share,user,password,domain;final int port;
        Credentials(String host,int port,String share,String user,String password,String domain){this.host=host;this.port=port;this.share=share;this.user=user;this.password=password;this.domain=domain;}
    }
    static final class Item {final String name;final boolean directory,link;final long size;
        Item(FileIdBothDirectoryInformation info){name=info.getFileName();long attrs=info.getFileAttributes();directory=(attrs&FileAttributes.FILE_ATTRIBUTE_DIRECTORY.getValue())!=0;link=(attrs&FileAttributes.FILE_ATTRIBUTE_REPARSE_POINT.getValue())!=0;size=info.getEndOfFile();}}
    static final class Listing {final List<Item> items=new ArrayList<>();boolean truncated;}
    interface Task<T>{T run(DiskShare share) throws Exception;}
    interface Result<T>{void done(T value,Exception error);}
    static <T> void execute(Activity activity,Credentials credentials,Task<T> task,Result<T> callback){
        new Thread(()->{
            T value=null;Exception failure=null;char[] password=credentials.password.toCharArray();
            try {
                SmbConfig config=SmbConfig.builder().withDialects(SMB2Dialect.SMB_3_0,SMB2Dialect.SMB_3_0_2,SMB2Dialect.SMB_3_1_1)
                    .withSigningRequired(true).withEncryptData(true).withDfsEnabled(false).withTimeout(30,TimeUnit.SECONDS).withSoTimeout(30,TimeUnit.SECONDS).build();
                try(SMBClient client=new SMBClient(config);Connection connection=client.connect(credentials.host,credentials.port);
                    Session session=connection.authenticate(new AuthenticationContext(credentials.user,password,credentials.domain))) {
                // SMBJ can negotiate without encryption even when the client prefers it; reject rather than downgrade.
                if(!session.shouldEncryptData())throw new IOException("Сервер не поддерживает обязательное SMB3-шифрование");
                try(Share share=session.connectShare(credentials.share)) {
                    if(!(share instanceof DiskShare))throw new IOException("Указанный ресурс не является файловой папкой");
                    value=task.run((DiskShare)share);
                }
                }
            }catch(Exception ex){failure=ex;}catch(LinkageError ex){failure=new IOException("SMB не поддерживается на этом устройстве",ex);}finally{Arrays.fill(password,'\0');}
            T result=value;Exception error=failure;
            activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())callback.done(result,error);});
        },"smb-operation").start();
    }
    static Listing list(DiskShare share,String path) throws Exception {
        Listing result=new Listing();
        try(Directory directory=share.openDirectory(path,EnumSet.of(AccessMask.FILE_LIST_DIRECTORY,AccessMask.FILE_READ_ATTRIBUTES),null,SMB2ShareAccess.ALL,SMB2CreateDisposition.FILE_OPEN,EnumSet.of(SMB2CreateOptions.FILE_OPEN_REPARSE_POINT))){
            for(FileIdBothDirectoryInformation info:directory){String name=info.getFileName();if(name.equals(".")||name.equals(".."))continue;
                if(result.items.size()>=1000){result.truncated=true;break;}result.items.add(new Item(info));}
        }
        Collections.sort(result.items,(a,b)->{int d=Boolean.compare(b.directory,a.directory);return d==0?a.name.compareToIgnoreCase(b.name):d;});return result;
    }
    static void download(Activity activity,DiskShare share,String remote,Uri local) throws Exception {
        try(com.hierynomus.smbj.share.File file=share.openFile(remote,EnumSet.of(AccessMask.FILE_READ_DATA,AccessMask.FILE_READ_ATTRIBUTES),null,SMB2ShareAccess.ALL,SMB2CreateDisposition.FILE_OPEN,EnumSet.of(SMB2CreateOptions.FILE_OPEN_REPARSE_POINT));
            InputStream in=file.getInputStream();OutputStream out=activity.getContentResolver().openOutputStream(local,"wt")){
            if(out==null)throw new IOException("Локальная запись недоступна");copy(in,out);
        }
    }
    static void upload(Activity activity,DiskShare share,Uri local,String remote) throws Exception {
        // FILE_CREATE fails atomically if the name exists; it never intentionally overwrites.
        try(InputStream in=activity.getContentResolver().openInputStream(local)){
            if(in==null)throw new IOException("Локальный файл недоступен");
            try(com.hierynomus.smbj.share.File file=share.openFile(remote,EnumSet.of(AccessMask.FILE_WRITE_DATA,AccessMask.FILE_READ_ATTRIBUTES),null,SMB2ShareAccess.ALL,SMB2CreateDisposition.FILE_CREATE,EnumSet.of(SMB2CreateOptions.FILE_OPEN_REPARSE_POINT));OutputStream out=file.getOutputStream()) {copy(in,out);}
        }
    }
    private static void copy(InputStream in,OutputStream out)throws IOException{byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
    static boolean safeName(String name){
        if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.endsWith(".")||name.endsWith(" "))return false;
        for(int i=0;i<name.length();i++){char c=name.charAt(i);if(c<32||"\\/:*?\"<>|".indexOf(c)>=0)return false;}return true;
    }
    static String join(String path,String name){return path.isEmpty()?name:path+"\\"+name;}
}
