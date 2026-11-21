package ru.aurora.filemanager;

import android.app.Activity;
import com.jcraft.jsch.Session;

/** A single local-only TCP forwarding rule, bound to this Activity's lifetime. */
final class SshTunnel {
    interface Completion { void done(SshTunnel tunnel, Exception error); }
    private Session session;
    private boolean cancelled, connecting=true;
    private int localPort;
    private final String targetHost;
    private final int targetPort;
    SshTunnel(String targetHost,int targetPort){this.targetHost=targetHost;this.targetPort=targetPort;}
    void start(Activity activity,SftpClient.Credentials credentials,int requestedPort,Completion completion){
        new Thread(()->{
            Session candidate=null;Exception failure=null;
            try {
                candidate=SshRunner.connect(activity,credentials.host,credentials.port,credentials.user,credentials.password);
                candidate.setServerAliveInterval(15000);candidate.setServerAliveCountMax(3);
                synchronized(this){
                    // Serialize cancellation with binding, and never expose Wi-Fi interfaces.
                    if(!cancelled){
                        localPort=candidate.setPortForwardingL("127.0.0.1",requestedPort,targetHost,targetPort);
                        session=candidate;candidate=null;
                    }
                }
            }catch(Exception e){failure=e;}
            finally {
                if(candidate!=null)candidate.disconnect();
                synchronized(this){connecting=false;}
            }
            Exception result=failure;
            activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())completion.done(this,result);});
        },"ssh-tunnel").start();
    }
    synchronized boolean isConnecting(){return connecting&&!cancelled;}
    synchronized boolean isRunning(){return !cancelled&&session!=null&&session.isConnected();}
    synchronized int getLocalPort(){return localPort;}
    String description(){return "127.0.0.1:"+getLocalPort()+" → "+targetHost+":"+targetPort;}
    void stop(){
        Session old;
        synchronized(this){cancelled=true;old=session;session=null;}
        if(old!=null)old.disconnect();
    }
}
