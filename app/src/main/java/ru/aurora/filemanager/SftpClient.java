package ru.aurora.filemanager;

import android.app.Activity;
import android.net.Uri;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.Session;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** One verified SSH connection per operation, closed even on error. */
final class SftpClient {
    static final class Credentials {
        final String host,user,password,keyId; final int port;
        Credentials(String host,int port,String user,String password){this(host,port,user,password,null);}
        Credentials(String host,int port,String user,String password,String keyId){this.host=host;this.port=port;this.user=user;this.password=password;this.keyId=keyId;}
    }
    static final class Item {
        final String name; final boolean directory, link; final long size;
        Item(String n,boolean d,boolean l,long s){name=n;directory=d;link=l;size=s;}
    }
    static final class Listing { final List<Item> items=new ArrayList<>(); boolean truncated; }
    interface Task<T>{T run(ChannelSftp channel) throws Exception;}
    interface Result<T>{void done(T value,Exception error);}
    static <T> void execute(Activity activity,Credentials credentials,Task<T> task,Result<T> result){
        new Thread(()->{
            Session session=null;SshRunner.KeyConnection keyConnection=null;ChannelSftp channel=null;T value=null;Exception error=null;
            try {
                if(credentials.keyId==null)session=SshRunner.connect(activity,credentials.host,credentials.port,credentials.user,credentials.password);
                else{keyConnection=SshRunner.connectSavedKey(activity,credentials.host,credentials.port,credentials.user,credentials.keyId,credentials.password);session=keyConnection.session;}
                channel=(ChannelSftp)session.openChannel("sftp");channel.connect(15000);
                value=task.run(channel);
            } catch(Exception e){error=e;}
            finally {if(channel!=null)channel.disconnect();if(keyConnection!=null)keyConnection.close();else if(session!=null)session.disconnect();}
            T answer=value;Exception failure=error;
            activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())result.done(answer,failure);});
        },"sftp-operation").start();
    }
    // JSch interprets *, ? and backslash as glob syntax even for SFTP paths.
    private static String literal(String path){return path.replace("\\","\\\\").replace("*","\\*").replace("?","\\?");}
    static Listing list(ChannelSftp channel,String directory) throws Exception {
        Listing result=new Listing();
        channel.ls(literal(directory),entry->{
            String name=entry.getFilename();
            if(name.equals(".")||name.equals(".."))return ChannelSftp.LsEntrySelector.CONTINUE;
            if(result.items.size()>=1000){result.truncated=true;return ChannelSftp.LsEntrySelector.BREAK;}
            result.items.add(new Item(name,entry.getAttrs().isDir(),entry.getAttrs().isLink(),entry.getAttrs().getSize()));
            return ChannelSftp.LsEntrySelector.CONTINUE;
        });
        Collections.sort(result.items,(a,b)->{int d=Boolean.compare(b.directory,a.directory);return d==0?a.name.compareToIgnoreCase(b.name):d;});
        return result;
    }
    static void download(Activity activity,ChannelSftp channel,String remote,Uri local) throws Exception {
        try(OutputStream out=activity.getContentResolver().openOutputStream(local,"wt")){
            if(out==null)throw new java.io.IOException("Не удалось открыть локальный файл для записи");
            channel.get(literal(remote),out);
        }
    }
    static void upload(Activity activity,ChannelSftp channel,Uri local,String remote) throws Exception {
        try(InputStream in=activity.getContentResolver().openInputStream(local)){
            if(in==null)throw new java.io.IOException("Не удалось открыть локальный файл");
            channel.put(in,literal(remote),ChannelSftp.OVERWRITE);
        }
    }
    static String join(String dir,String name){return dir.endsWith("/")?dir+name:dir+"/"+name;}
}
