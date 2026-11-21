package ru.aurora.filemanager;

import android.app.Activity;
import android.net.Uri;
import org.apache.commons.net.ftp.FTP;
import org.apache.commons.net.ftp.FTPClient;
import org.apache.commons.net.ftp.FTPFile;
import org.apache.commons.net.ftp.FTPReply;
import org.apache.commons.net.ftp.FTPSClient;
import java.io.*;
import java.net.Socket;
import java.util.*;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSocket;

/** Passive FTP or explicit FTPS, one connection per operation. */
final class FtpAccess {
    static final class Credentials {
        final String host,user,password;final int port;final boolean tls;
        Credentials(String host,int port,String user,String password,boolean tls){this.host=host;this.port=port;this.user=user;this.password=password;this.tls=tls;}
    }
    static final class Item {
        final String name;final boolean directory,link;final long size;
        Item(FTPFile f){name=f.getName();directory=f.isDirectory();link=f.isSymbolicLink();size=f.getSize();}
    }
    static final class Listing {final List<Item> items=new ArrayList<>();boolean truncated;}
    interface Task<T>{T run(FTPClient client) throws Exception;}
    interface Result<T>{void done(T value,Exception error);}

    /** Commons Net does not enable hostname checks on data sockets by default. */
    private static final class VerifiedFtps extends FTPSClient {
        private final String host;
        VerifiedFtps(String host) throws Exception {super(false,SSLContext.getDefault());this.host=host;setEndpointCheckingEnabled(true);}
        @Override protected Socket _openDataConnection_(String command,String arg) throws IOException {
            Socket socket=super._openDataConnection_(command,arg);
            if(socket==null)return null;
            if(!(socket instanceof SSLSocket)||!HttpsURLConnection.getDefaultHostnameVerifier().verify(host,((SSLSocket)socket).getSession())){
                socket.close();throw new SSLException("Сертификат канала данных не соответствует имени сервера");
            }
            return socket;
        }
    }
    static <T> void execute(Activity activity,Credentials c,Task<T> task,Result<T> callback){
        new Thread(()->{
            FTPClient client=null;T value=null;Exception failure=null;
            try {
                client=c.tls?new VerifiedFtps(c.host):new FTPClient();
                client.setConnectTimeout(15000);client.setDefaultTimeout(30000);client.setDataTimeout(java.time.Duration.ofSeconds(30));
                client.setControlEncoding("UTF-8");client.setIpAddressFromPasvResponse(false);client.setRemoteVerificationEnabled(true);
                client.connect(c.host,c.port);
                if(!FTPReply.isPositiveCompletion(client.getReplyCode()))throw new IOException("Сервер отклонил соединение");
                if(!client.login(c.user,c.password))throw new IOException("Сервер отклонил вход");
                if(client instanceof FTPSClient){FTPSClient secure=(FTPSClient)client;secure.execPBSZ(0);secure.execPROT("P");}
                client.enterLocalPassiveMode();
                if(!client.setFileType(FTP.BINARY_FILE_TYPE))throw new IOException("Сервер не поддерживает бинарный режим");
                value=task.run(client);
            }catch(Exception e){failure=e;}
            finally {if(client!=null&&client.isConnected()){try{client.disconnect();}catch(IOException ignored){}}}
            T result=value;Exception error=failure;
            activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())callback.done(result,error);});
        },"ftp-operation").start();
    }
    static Listing list(FTPClient client,String dir) throws IOException {
        FTPFile[] entries=client.listFiles(dir);
        if(!FTPReply.isPositiveCompletion(client.getReplyCode()))throw new IOException("Не удалось получить список папки");
        Listing result=new Listing();
        for(FTPFile file:entries){String n=file.getName();if(n==null||n.equals(".")||n.equals(".."))continue;if(result.items.size()>=1000){result.truncated=true;break;}result.items.add(new Item(file));}
        Collections.sort(result.items,(a,b)->{int d=Boolean.compare(b.directory,a.directory);return d==0?a.name.compareToIgnoreCase(b.name):d;});return result;
    }
    static void download(Activity activity,FTPClient client,String remote,Uri destination) throws IOException {
        try(OutputStream out=activity.getContentResolver().openOutputStream(destination,"wt")){
            if(out==null)throw new IOException("Локальная запись недоступна");if(!client.retrieveFile(remote,out))throw new IOException("Сервер не завершил скачивание");
        }
    }
    static void upload(Activity activity,FTPClient client,Uri source,String remote) throws IOException {
        try(InputStream in=activity.getContentResolver().openInputStream(source)){
            if(in==null)throw new IOException("Локальный файл недоступен");if(!client.storeFile(remote,in))throw new IOException("Сервер не завершил загрузку");
        }
    }
    static boolean validCommandText(String s){return s!=null && !s.isEmpty() && s.indexOf('\r')<0 && s.indexOf('\n')<0 && s.indexOf('\0')<0;}
    static String join(String dir,String name){return dir.endsWith("/")?dir+name:dir+"/"+name;}
}
