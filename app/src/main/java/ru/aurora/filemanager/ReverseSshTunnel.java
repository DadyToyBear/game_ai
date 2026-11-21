package ru.aurora.filemanager;

import android.app.Activity;
import android.os.CancellationSignal;
import com.jcraft.jsch.Session;

/** Requests a loopback listener on the SSH server forwarding to Android loopback. */
final class ReverseSshTunnel {
    interface Completion {void done(ReverseSshTunnel tunnel,Exception failure);}
    private final CancellationSignal cancellation=new CancellationSignal();
    private final int remotePort,localPort;
    private Session session;private boolean stopped,connecting=true,ready;
    ReverseSshTunnel(int remotePort,int localPort){if(remotePort<1||remotePort>65535||localPort<1||localPort>65535)throw new IllegalArgumentException("Invalid port");this.remotePort=remotePort;this.localPort=localPort;}
    void start(Activity activity,SftpClient.Credentials credentials,Completion completion){
        new Thread(()->{
            Session candidate=null;Exception failure=null;
            try{
                candidate=SshRunner.connect(activity,credentials.host,credentials.port,credentials.user,credentials.password,cancellation);
                candidate.setServerAliveInterval(15000);candidate.setServerAliveCountMax(3);
                synchronized(this){if(stopped)return;session=candidate;}
                // The server can override the requested loopback binding (GatewayPorts).
                candidate.setPortForwardingR("127.0.0.1",remotePort,"127.0.0.1",localPort);
                synchronized(this){if(stopped)return;ready=true;candidate=null;}
            }catch(Exception ex){failure=ex;}
            finally{
                if(candidate!=null){candidate.disconnect();synchronized(this){if(session==candidate)session=null;}}
                synchronized(this){connecting=false;}
                Exception result=failure;
                activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())completion.done(this,result);});
            }
        },"ssh-reverse-tunnel").start();
    }
    synchronized boolean isConnecting(){return connecting&&!stopped;}
    synchronized boolean isRunning(){return !stopped&&ready&&session!=null&&session.isConnected();}
    String description(){return "SSH-сервер 127.0.0.1:"+remotePort+" → телефон 127.0.0.1:"+localPort;}
    void stop(){
        Session old;synchronized(this){if(stopped)return;stopped=true;ready=false;old=session;session=null;}
        cancellation.cancel();
        if(old!=null)new Thread(old::disconnect,"ssh-reverse-close").start();
    }
}
