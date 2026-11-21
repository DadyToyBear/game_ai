package ru.aurora.filemanager;

import android.app.Activity;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.Session;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Line-oriented SSH shell, with bounded UI buffering and no terminal emulation. */
final class InteractiveSsh {
    interface Listener {void connected();void output(String text);void finished(String reason);}
    private final Activity activity;private final Listener listener;private final Handler main=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor writer=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16));
    private final CancellationSignal cancellation=new CancellationSignal();
    private final StringBuilder pending=new StringBuilder();
    private boolean closed,connected,outputScheduled;private Session session;private ChannelShell channel;private OutputStream output;
    InteractiveSsh(Activity activity,Listener listener){this.activity=activity;this.listener=listener;}
    void start(SftpClient.Credentials credentials){
        new Thread(()->{
            Session localSession=null;ChannelShell localChannel=null;String reason="SSH-сеанс завершён";
            try{
                localSession=SshRunner.connect(activity,credentials.host,credentials.port,credentials.user,credentials.password,cancellation);
                localSession.setServerAliveInterval(15000);localSession.setServerAliveCountMax(3);
                synchronized(this){if(closed)return;}
                localChannel=(ChannelShell)localSession.openChannel("shell");localChannel.setPty(true);localChannel.setPtyType("dumb",80,24,0,0);
                InputStream input=localChannel.getInputStream();OutputStream outbound=localChannel.getOutputStream();localChannel.connect(15000);
                synchronized(this){if(closed)return;session=localSession;channel=localChannel;output=outbound;connected=true;}
                main.post(()->{synchronized(this){if(closed)return;}listener.connected();});
                try(Reader reader=new InputStreamReader(input,StandardCharsets.UTF_8)){
                    char[] buf=new char[2048];int n;while((n=reader.read(buf))!=-1)queueOutput(new String(buf,0,n));
                }
            }catch(Exception ex){reason="Ошибка SSH: "+ex.getMessage();}
            finally{
                synchronized(this){connected=false;session=null;channel=null;output=null;}
                if(localChannel!=null)localChannel.disconnect();if(localSession!=null)localSession.disconnect();writer.shutdownNow();
                String message=reason;main.post(()->{synchronized(this){if(closed)return;closed=true;}listener.finished(message);});
            }
        },"ssh-shell").start();
    }
    private void queueOutput(String text){
        synchronized(this){
            if(closed)return;pending.append(text);
            if(pending.length()>32768)pending.delete(0,pending.length()-32768);
            if(outputScheduled)return;outputScheduled=true;
        }
        main.post(()->{
            String textToShow;synchronized(this){outputScheduled=false;if(closed){pending.setLength(0);return;}textToShow=pending.toString();pending.setLength(0);}
            listener.output(textToShow);
        });
    }
    boolean send(byte[] data){
        synchronized(this){if(closed||!connected||output==null)return false;}
        try{writer.execute(()->{
            OutputStream stream;synchronized(this){if(closed||!connected)return;stream=output;}
            try{stream.write(data);stream.flush();}catch(IOException ex){stop();main.post(()->listener.finished("Ошибка отправки: "+ex.getMessage()));}
        });return true;}catch(RejectedExecutionException ex){return false;}
    }
    void stop(){
        Session oldSession;ChannelShell oldChannel;
        synchronized(this){if(closed)return;closed=true;connected=false;oldSession=session;oldChannel=channel;session=null;channel=null;output=null;pending.setLength(0);}
        cancellation.cancel();writer.shutdownNow();
        // Closing a network channel must not block Android's UI thread.
        if(oldChannel!=null||oldSession!=null)new Thread(()->{if(oldChannel!=null)oldChannel.disconnect();if(oldSession!=null)oldSession.disconnect();},"ssh-shell-close").start();
    }
}
