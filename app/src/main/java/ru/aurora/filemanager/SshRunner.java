package ru.aurora.filemanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.util.Base64;
import android.os.CancellationSignal;
import com.jcraft.jsch.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Executes one command per connection; verifies the host key interactively on every connection. */
final class SshRunner {
    interface Result { void done(String output); }
    static void run(Activity activity, String host, int port, String user, String password, String command, Result result) {
        new Thread(() -> {
            Session session=null; ChannelExec channel=null; String output;
            try {
                session=connect(activity,host,port,user,password);
                channel=(ChannelExec)session.openChannel("exec"); channel.setCommand(command);
                LimitedOutput stderr=new LimitedOutput(); channel.setErrStream(stderr); InputStream in=channel.getInputStream(); channel.connect(15000);
                LimitedOutput stdout=new LimitedOutput(); byte[] buf=new byte[4096]; int n; while((n=in.read(buf))!=-1) stdout.write(buf,0,n);
                output=stdout.toString("UTF-8")+stderr.toString("UTF-8")+"\nКод завершения: "+channel.getExitStatus();
                if(stdout.truncated || stderr.truncated) output+="\nВывод обрезан до 64 КиБ на поток.";
            } catch(Exception e) { output="Ошибка SSH: "+e.getMessage(); }
            finally { if(channel!=null) channel.disconnect(); if(session!=null) session.disconnect(); }
            String answer=output; activity.runOnUiThread(() -> { if(!activity.isFinishing()&&!activity.isDestroyed()) result.done(answer); });
        },"ssh-command").start();
    }
    static Session connect(Activity activity,String host,int port,String user,String password) throws Exception {
        return connect(activity,host,port,user,password,null);
    }
    static Session connect(Activity activity,String host,int port,String user,String password,CancellationSignal cancel) throws Exception {
        return connectWithIdentity(activity,host,port,user,password,cancel,new JSch(),false);
    }
    private static Session connectWithIdentity(Activity activity,String host,int port,String user,String password,CancellationSignal cancel,JSch jsch,boolean publicKey) throws Exception {
        jsch.setHostKeyRepository(new HostKeyRepository() {
            public int check(String name,byte[] key){
                CountDownLatch latch=new CountDownLatch(1);AtomicBoolean approved=new AtomicBoolean(false),active=new AtomicBoolean(true);
                AtomicReference<AlertDialog> dialogRef=new AtomicReference<>();
                try {
                    if(cancel!=null)cancel.setOnCancelListener(()->{
                        active.set(false);latch.countDown();
                        activity.runOnUiThread(()->{AlertDialog dialog=dialogRef.getAndSet(null);if(dialog!=null)dialog.dismiss();});
                    });
                    String fingerprint="SHA256:"+Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key),Base64.NO_WRAP|Base64.NO_PADDING);
                    activity.runOnUiThread(()->{
                        if(!active.get()||(cancel!=null&&cancel.isCanceled())||activity.isFinishing()||activity.isDestroyed()){latch.countDown();return;}
                        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("Проверка SSH-ключа")
                            .setMessage("Сравните отпечаток с ключом сервера по независимому каналу:\n\n"+name+"\n"+fingerprint+"\n\nПродолжить только при совпадении.")
                            .setPositiveButton("Совпадает",(d,w)->{approved.set(true);latch.countDown();})
                            .setNegativeButton("Отмена",(d,w)->latch.countDown()).setOnCancelListener(d->latch.countDown()).create();
                        dialogRef.set(dialog);
                        if(!active.get()||(cancel!=null&&cancel.isCanceled())){dialogRef.set(null);latch.countDown();return;}
                        dialog.show();
                    });
                    boolean result=latch.await(60,TimeUnit.SECONDS)&&approved.get()&&(cancel==null||!cancel.isCanceled());
                    return result?OK:CHANGED;
                }catch(Exception e){return CHANGED;}
                finally {
                    active.set(false);
                    activity.runOnUiThread(()->{AlertDialog dialog=dialogRef.getAndSet(null);if(dialog!=null)dialog.dismiss();});
                    if(cancel!=null)cancel.setOnCancelListener(null);
                }
            }
            public void add(HostKey h,UserInfo u){} public void remove(String h,String t){} public void remove(String h,String t,byte[] k){}
            public String getKnownHostsRepositoryID(){return "interactive";} public HostKey[] getHostKey(){return new HostKey[0];} public HostKey[] getHostKey(String h,String t){return new HostKey[0];}
        });
        if(cancel!=null)cancel.throwIfCanceled();
        Session session=jsch.getSession(user,host,port);if(!publicKey)session.setPassword(password);
        session.setConfig("StrictHostKeyChecking","yes");session.setConfig("PreferredAuthentications",publicKey?"publickey":"password");
        try{session.connect(15000);if(cancel!=null)cancel.throwIfCanceled();session.setTimeout(30000);return session;}
        catch(Exception ex){session.disconnect();throw ex;}
    }
    /** The key is read into bounded temporary memory; never saved to app storage. */
    static byte[] readKey(InputStream in,CancellationSignal cancel) throws IOException {
        byte[] buffer=new byte[65537];int length=0;
        try{while(length<buffer.length){cancel.throwIfCanceled();int count=in.read(buffer,length,buffer.length-length);if(count<0)break;if(count==0)throw new IOException("Чтение ключа остановилось");length+=count;}
            if(length==0||length>65536)throw new IOException("Файл ключа пуст или больше 64 КиБ");return java.util.Arrays.copyOf(buffer,length);
        }finally{java.util.Arrays.fill(buffer,(byte)0);}
    }
    static void runWithKey(Activity activity,android.net.Uri keyUri,String host,int port,String user,byte[] passphrase,String command,CancellationSignal cancel,Result result){
        new Thread(()->{
            JSch jsch=new JSch();Session session=null;ChannelExec channel=null;byte[] key=null;String output;
            try{
                try(InputStream in=activity.getContentResolver().openInputStream(keyUri)){if(in==null)throw new IOException("Файл ключа недоступен");key=readKey(in,cancel);}
                try{jsch.addIdentity("selected-key",key,null,passphrase.length==0?null:passphrase);}finally{java.util.Arrays.fill(key,(byte)0);key=null;java.util.Arrays.fill(passphrase,(byte)0);}
                cancel.throwIfCanceled();session=connectWithIdentity(activity,host,port,user,null,cancel,jsch,true);
                Session active=session;cancel.setOnCancelListener(()->new Thread(active::disconnect,"ssh-key-close").start());cancel.throwIfCanceled();
                channel=(ChannelExec)session.openChannel("exec");channel.setCommand(command);
                LimitedOutput stderr=new LimitedOutput();channel.setErrStream(stderr);InputStream in=channel.getInputStream();channel.connect(15000);
                LimitedOutput stdout=new LimitedOutput();byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1){cancel.throwIfCanceled();stdout.write(buf,0,n);}
                output=stdout.toString("UTF-8")+stderr.toString("UTF-8")+"\nКод завершения: "+channel.getExitStatus();
                if(stdout.truncated||stderr.truncated)output+="\nВывод обрезан до 64 КиБ на поток.";
            }catch(Exception ex){output="Ошибка SSH: "+ex.getMessage();}
            finally{cancel.setOnCancelListener(null);if(channel!=null)channel.disconnect();if(session!=null)session.disconnect();try{jsch.removeAllIdentity();}catch(Exception ignored){}if(key!=null)java.util.Arrays.fill(key,(byte)0);java.util.Arrays.fill(passphrase,(byte)0);}
            String answer=output;activity.runOnUiThread(()->{if(!cancel.isCanceled()&&!activity.isFinishing()&&!activity.isDestroyed())result.done(answer);});
        },"ssh-key-command").start();
    }
    private static final class LimitedOutput extends ByteArrayOutputStream {
        boolean truncated;
        @Override public synchronized void write(byte[] b,int off,int len){int count=Math.min(len,Math.max(0,65536-size()));super.write(b,off,count);if(count<len)truncated=true;}
        @Override public synchronized void write(int b){if(size()<65536)super.write(b);else truncated=true;}
    }
}
