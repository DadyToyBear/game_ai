package ru.aurora.filemanager;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.*;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/** Minimal RFB 3.3/3.7/3.8 client: raw true-colour frames and basic input. No TLS. */
final class VncClient {
    static final int MAX_PIXELS=1920*1080,MAX_RECTS=256,MAX_UPDATE_BYTES=16*1024*1024;
    interface Listener {void connected(int width,int height,String name);void frame(int width,int height,int[] argb);void finished(String reason);}
    private final Listener listener;private final Object lock=new Object(),writeLock=new Object();
    private final ThreadPoolExecutor writer=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
    private Socket socket;private DataOutputStream out;private boolean stopped,ready;private int width,height;
    VncClient(Listener listener){this.listener=listener;}
    static boolean validPassword(String password){return password!=null&&password.length()>=1&&password.length()<=8&&password.matches("[\\x20-\\x7e]+");}
    static byte[] challengeResponse(String password,byte[] challenge) throws Exception {
        if(!validPassword(password)||challenge.length!=16)throw new IOException("Пароль VNC: от 1 до 8 печатных ASCII-символов");
        byte[] key=new byte[8],raw=password.getBytes(StandardCharsets.US_ASCII);System.arraycopy(raw,0,key,0,raw.length);Arrays.fill(raw,(byte)0);
        for(int i=0;i<key.length;i++)key[i]=(byte)(Integer.reverse(key[i]&255)>>>24);
        try{Cipher cipher=Cipher.getInstance("DES/ECB/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"DES"));return cipher.doFinal(challenge);}finally{Arrays.fill(key,(byte)0);}
    }
    void start(String host,int port,String password,boolean allowNone){
        new Thread(()->{
            String reason="Соединение закрыто";Socket s=new Socket();
            try{
                synchronized(lock){if(stopped)return;socket=s;}
                s.connect(new InetSocketAddress(host,port),15000);s.setSoTimeout(20000);
                DataInputStream in=new DataInputStream(new BufferedInputStream(s.getInputStream()));DataOutputStream output=new DataOutputStream(new BufferedOutputStream(s.getOutputStream()));
                synchronized(lock){if(stopped)return;out=output;}
                byte[] version=new byte[12];in.readFully(version);String banner=new String(version,StandardCharsets.US_ASCII);int minor=version(banner);
                output.write(String.format(java.util.Locale.ROOT,"RFB 003.%03d\n",minor).getBytes(StandardCharsets.US_ASCII));output.flush();
                boolean none=false,vnc=false;int chosen;
                if(minor==3){int offered=in.readInt();if(offered==0)throw new IOException("Сервер отклонил соединение: "+readMessage(in));none=offered==1;vnc=offered==2;}
                else {int count=in.readUnsignedByte();if(count==0)throw new IOException("Сервер отклонил соединение: "+readMessage(in));for(int i=0;i<count;i++){int type=in.readUnsignedByte();none|=type==1;vnc|=type==2;}}
                chosen=vnc&&validPassword(password)?2:allowNone&&none?1:0;
                if(chosen==0)throw new IOException("Нет подходящего способа входа: нужен пароль VNC или явно разрешённый вход без пароля");
                if(minor!=3){output.writeByte(chosen);output.flush();}
                if(chosen==2){byte[] challenge=new byte[16];in.readFully(challenge);byte[] response=challengeResponse(password,challenge);try{output.write(response);output.flush();}finally{Arrays.fill(response,(byte)0);}}
                if(chosen==2||minor==8){int auth=in.readInt();if(auth!=0)throw new IOException(minor==8?"Вход отклонён: "+readMessage(in):"Вход отклонён сервером");}
                output.writeByte(1);output.flush();int w=in.readUnsignedShort(),h=in.readUnsignedShort();validateSize(w,h);
                byte[] format=new byte[16];in.readFully(format);String name=readMessage(in);
                synchronized(lock){if(stopped)return;width=w;height=h;}
                // 32-bit little-endian, true colour RGB888, raw encoding only.
                output.writeByte(0);output.write(new byte[3]);output.writeByte(32);output.writeByte(24);output.writeByte(0);output.writeByte(1);
                output.writeShort(255);output.writeShort(255);output.writeShort(255);output.writeByte(16);output.writeByte(8);output.writeByte(0);output.write(new byte[3]);
                output.writeByte(2);output.writeByte(0);output.writeShort(1);output.writeInt(0);output.flush();
                int[] pixels=new int[w*h];Arrays.fill(pixels,0xff000000);s.setSoTimeout(0);
                synchronized(lock){if(stopped)return;ready=true;}listener.connected(w,h,name);request(false,w,h);
                while(!isStopped()){
                    int type=in.readUnsignedByte();
                    if(type==0){in.readUnsignedByte();int rects=in.readUnsignedShort();if(rects>MAX_RECTS)throw new IOException("Слишком много прямоугольников");long updateBytes=0;
                        byte[] row=new byte[w*4];for(int r=0;r<rects;r++){
                            int x=in.readUnsignedShort(),y=in.readUnsignedShort(),rw=in.readUnsignedShort(),rh=in.readUnsignedShort();int encoding=in.readInt();
                            if(encoding!=0||rw==0||rh==0||x+rw>w||y+rh>h)throw new IOException("Неподдерживаемый или некорректный кадр");
                            updateBytes+=(long)rw*rh*4;if(updateBytes>MAX_UPDATE_BYTES)throw new IOException("Слишком большой кадр");
                            for(int yy=0;yy<rh;yy++){in.readFully(row,0,rw*4);for(int xx=0;xx<rw;xx++){int pos=xx*4;pixels[(y+yy)*w+x+xx]=0xff000000|((row[pos+2]&255)<<16)|((row[pos+1]&255)<<8)|(row[pos]&255);}}
                        }
                        if(rects>0)listener.frame(w,h,pixels.clone());
                        Thread.sleep(50);request(true,w,h);
                    }else if(type==2){/* bell intentionally ignored */}
                    else if(type==3){byte[] padding=new byte[3];in.readFully(padding);long size=Integer.toUnsignedLong(in.readInt());if(size>1048576)throw new IOException("Слишком большие данные буфера обмена");byte[] ignored=new byte[4096];while(size>0){int n=(int)Math.min(size,ignored.length);in.readFully(ignored,0,n);size-=n;}}
                    else throw new IOException("Неподдерживаемое сообщение VNC: "+type);
                }
            }catch(Exception ex){if(!isStopped())reason="Ошибка VNC: "+(ex.getMessage()==null?ex.toString():ex.getMessage());}
             catch(OutOfMemoryError ex){reason="Недостаточно памяти для удалённого экрана";}
            finally{stop();listener.finished(reason);}
        },"vnc-reader").start();
    }
    static int version(String banner) throws IOException {
        if("RFB 003.003\n".equals(banner))return 3;if("RFB 003.007\n".equals(banner))return 7;if("RFB 003.008\n".equals(banner))return 8;
        throw new IOException("Поддерживаются только RFB 3.3, 3.7 и 3.8");
    }
    private static void validateSize(int w,int h) throws IOException {if(w<1||h<1||(long)w*h>MAX_PIXELS)throw new IOException("Размер экрана превышает 2073600 пикселей");}
    private static String readMessage(DataInputStream in) throws IOException {long length=Integer.toUnsignedLong(in.readInt());if(length>4096)throw new IOException("Слишком длинное сообщение сервера");byte[] bytes=new byte[(int)length];in.readFully(bytes);return new String(bytes,StandardCharsets.UTF_8);}
    private void request(boolean incremental,int w,int h) throws IOException {synchronized(writeLock){DataOutputStream o=out;if(o==null)throw new IOException("Соединение закрыто");o.writeByte(3);o.writeByte(incremental?1:0);o.writeShort(0);o.writeShort(0);o.writeShort(w);o.writeShort(h);o.flush();}}
    private boolean enqueue(Runnable action){synchronized(lock){if(stopped||!ready)return false;}try{writer.execute(action);return true;}catch(RejectedExecutionException ex){stop();return false;}}
    boolean pointer(int x,int y,boolean down){int w,h;synchronized(lock){w=width;h=height;}if(x<0||y<0||x>=w||y>=h)return false;
        return enqueue(()->{try{synchronized(writeLock){if(out==null)return;out.writeByte(5);out.writeByte(down?1:0);out.writeShort(x);out.writeShort(y);out.flush();}}catch(IOException ex){stop();}});}
    boolean click(int x,int y,int mask){int w,h;synchronized(lock){w=width;h=height;}if(x<0||y<0||x>=w||y>=h||(mask!=4&&mask!=8&&mask!=16))return false;
        return enqueue(()->{try{synchronized(writeLock){if(out==null)return;out.writeByte(5);out.writeByte(mask);out.writeShort(x);out.writeShort(y);out.writeByte(5);out.writeByte(0);out.writeShort(x);out.writeShort(y);out.flush();}}catch(IOException ex){stop();}});}
    static int[] keysyms(String text){
        if(text==null||text.isEmpty()||text.codePointCount(0,text.length())>256)return null;int[] result=new int[text.codePointCount(0,text.length())];int n=0;
        for(int i=0;i<text.length();){int cp=text.codePointAt(i);if(Character.isISOControl(cp)||(cp>=0xd800&&cp<=0xdfff))return null;
            result[n++]=cp<=0xff?cp:0x01000000|cp;i+=Character.charCount(cp);
        }return result;
    }
    boolean keys(String text){int[] keys=keysyms(text);if(keys==null)return false;
        return enqueue(()->{try{synchronized(writeLock){if(out==null)return;for(int key:keys){writeKey(out,true,key);writeKey(out,false,key);}out.flush();}}catch(IOException ex){stop();}});}
    boolean special(int keysym){if(keysym!=0xff0d&&keysym!=0xff08&&keysym!=0xff1b&&keysym!=0xff09)return false;
        return enqueue(()->{try{synchronized(writeLock){if(out==null)return;writeKey(out,true,keysym);writeKey(out,false,keysym);out.flush();}}catch(IOException ex){stop();}});}
    private static void writeKey(DataOutputStream out,boolean down,int key) throws IOException {out.writeByte(4);out.writeByte(down?1:0);out.writeShort(0);out.writeInt(key);}
    private boolean isStopped(){synchronized(lock){return stopped;}}
    void stop(){Socket old;synchronized(lock){if(stopped)return;stopped=true;ready=false;old=socket;socket=null;}writer.shutdownNow();if(old!=null)try{old.close();}catch(IOException ignored){}}
}
