package ru.aurora.filemanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.util.Base64;
import com.jcraft.jsch.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Executes one command per connection; verifies the host key interactively on every connection. */
final class SshRunner {
    interface Result { void done(String output); }
    static void run(Activity activity, String host, int port, String user, String password, String command, Result result) {
        new Thread(() -> {
            Session session=null; ChannelExec channel=null; String output;
            try {
                JSch jsch=new JSch();
                jsch.setHostKeyRepository(new HostKeyRepository() {
                    public int check(String name, byte[] key) {
                        try {
                            String fingerprint="SHA256:"+Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key),Base64.NO_WRAP|Base64.NO_PADDING);
                            CountDownLatch latch=new CountDownLatch(1); AtomicBoolean approved=new AtomicBoolean(false);
                            activity.runOnUiThread(() -> {
                                if(activity.isFinishing() || activity.isDestroyed()){latch.countDown();return;}
                                new AlertDialog.Builder(activity).setTitle("Проверка SSH-ключа")
                                    .setMessage("Сравните отпечаток с ключом сервера по независимому каналу:\n\n"+name+"\n"+fingerprint+"\n\nПродолжить только при совпадении.")
                                    .setPositiveButton("Совпадает",(d,w)->{approved.set(true);latch.countDown();})
                                    .setNegativeButton("Отмена",(d,w)->latch.countDown())
                                    .setOnCancelListener(d->latch.countDown()).show();
                            });
                            return latch.await(60,TimeUnit.SECONDS) && approved.get() ? OK : CHANGED;
                        } catch(Exception e) { return CHANGED; }
                    }
                    public void add(HostKey h, UserInfo u) {} public void remove(String h,String t) {} public void remove(String h,String t,byte[] k) {}
                    public String getKnownHostsRepositoryID(){return "interactive";} public HostKey[] getHostKey(){return new HostKey[0];} public HostKey[] getHostKey(String h,String t){return new HostKey[0];}
                });
                session=jsch.getSession(user,host,port); session.setPassword(password);
                session.setConfig("StrictHostKeyChecking","yes"); session.setConfig("PreferredAuthentications","password");
                session.connect(15000); session.setTimeout(30000);
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
    private static final class LimitedOutput extends ByteArrayOutputStream {
        boolean truncated;
        @Override public synchronized void write(byte[] b,int off,int len){int count=Math.min(len,Math.max(0,65536-size()));super.write(b,off,count);if(count<len)truncated=true;}
        @Override public synchronized void write(int b){if(size()<65536)super.write(b);else truncated=true;}
    }
}
