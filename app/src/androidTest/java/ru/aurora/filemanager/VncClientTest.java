package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class VncClientTest {
    @Test public void rfb38RawFramesAndInputWithVncPassword() throws Exception {
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){
            AtomicReference<Throwable> failure=new AtomicReference<>();CountDownLatch events=new CountDownLatch(1);Thread peer=new Thread(()->{
                try(Socket socket=server.accept()){
                    socket.setSoTimeout(15000);DataInputStream in=new DataInputStream(socket.getInputStream());DataOutputStream out=new DataOutputStream(socket.getOutputStream());
                    out.write("RFB 003.008\n".getBytes(StandardCharsets.US_ASCII));out.flush();byte[] version=new byte[12];in.readFully(version);assertEquals("RFB 003.008\n",new String(version,StandardCharsets.US_ASCII));
                    out.writeByte(2);out.writeByte(1);out.writeByte(2);out.flush();assertEquals(2,in.readUnsignedByte());byte[] challenge=new byte[16];for(int i=0;i<16;i++)challenge[i]=(byte)i;out.write(challenge);out.flush();
                    byte[] response=new byte[16];in.readFully(response);byte[] expected={(byte)0xb8,0x66,(byte)0x92,0x41,0x25,(byte)0xc8,(byte)0xee,(byte)0xbb,(byte)0x9d,(byte)0xeb,(byte)0xc1,(byte)0xdb,0x61,(byte)0xc5,0x38,(byte)0xe2};assertArrayEquals(expected,response);
                    out.writeInt(0);out.flush();assertEquals(1,in.readUnsignedByte());out.writeShort(2);out.writeShort(2);out.write(new byte[16]);byte[] name="test".getBytes(StandardCharsets.UTF_8);out.writeInt(name.length);out.write(name);out.flush();
                    byte[] format=new byte[20];in.readFully(format);assertEquals(0,format[0]);assertEquals(32,format[4]);assertEquals(1,format[7]);byte[] encodings=new byte[8];in.readFully(encodings);assertEquals(2,encodings[0]);assertEquals(0,encodings[7]);
                    assertEquals(3,in.readUnsignedByte());byte[] req=new byte[9];in.readFully(req);assertEquals(0,req[0]);
                    out.writeByte(0);out.writeByte(0);out.writeShort(1);out.writeShort(0);out.writeShort(0);out.writeShort(2);out.writeShort(2);out.writeInt(0);
                    out.write(new byte[]{0,0,(byte)255,0, 0,(byte)255,0,0, (byte)255,0,0,0, (byte)255,(byte)255,(byte)255,0});out.writeByte(3);out.write(new byte[3]);out.writeInt(4);out.write(new byte[]{99,97,102,(byte)0xe9});out.flush();
                    int pointer=0,key=0,clipboard=0;while(pointer<6||key<6||clipboard<1){int type=in.readUnsignedByte();if(type==3){in.readFully(req);}else if(type==5){int mask=in.readUnsignedByte(),x=in.readUnsignedShort(),y=in.readUnsignedShort();assertEquals(1,x);assertEquals(0,y);assertEquals(new int[]{1,0,4,0,16,0}[pointer],mask);pointer++;}else if(type==4){int down=in.readUnsignedByte();in.readUnsignedShort();int sym=in.readInt();assertEquals(new int[]{'A','A',0x0100042f,0x0100042f,0xff51,0xff51}[key],sym);assertEquals(key%2==0?1:0,down);key++;}else if(type==6){byte[] padding=new byte[3];in.readFully(padding);int length=in.readInt();assertEquals(4,length);byte[] value=new byte[length];in.readFully(value);assertArrayEquals(new byte[]{99,97,102,(byte)0xe9},value);clipboard++;}else throw new IOException("Unexpected message: "+type);}
                    events.countDown();
                }catch(Throwable ex){failure.set(ex);events.countDown();}
            },"test-vnc-server");peer.start();
            CountDownLatch received=new CountDownLatch(1),clipReceived=new CountDownLatch(1);AtomicReference<String> clip=new AtomicReference<>();AtomicReference<int[]> pixels=new AtomicReference<>();AtomicReference<String> problem=new AtomicReference<>();
            VncClient client=new VncClient(new VncClient.Listener(){public void connected(int w,int h,String name){assertEquals(2,w);assertEquals(2,h);assertEquals("test",name);}public void frame(int w,int h,int[] p){pixels.set(p);received.countDown();}public void clipboard(String text){clip.set(text);clipReceived.countDown();}public void finished(String reason){problem.set(reason);}});
            try{client.start("127.0.0.1",server.getLocalPort(),"password",false);assertTrue("frame "+problem.get(),received.await(15,TimeUnit.SECONDS));assertArrayEquals(new int[]{0xffff0000,0xff00ff00,0xff0000ff,0xffffffff},pixels.get());
                assertTrue(client.pointer(1,0,true));assertTrue(client.pointer(1,0,false));assertTrue(client.click(1,0,4));assertTrue(client.click(1,0,16));assertTrue(client.keys("AЯ"));assertTrue(client.special(0xff51));assertTrue(client.sendClipboard("café"));assertTrue(clipReceived.await(15,TimeUnit.SECONDS));assertEquals("café",clip.get());assertFalse(client.special(0xdead));assertTrue(events.await(15,TimeUnit.SECONDS));if(failure.get()!=null)throw new AssertionError(failure.get());
            }finally{client.stop();peer.join(5000);}
        }
    }
    @Test public void acceptsLegacyNoneAndPasswordWithoutImplicitDowngrade() throws Exception {
        for(int minor:new int[]{3,7})for(boolean auth:new boolean[]{false,true}){
            try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){
                CountDownLatch connected=new CountDownLatch(1);AtomicReference<Throwable> failure=new AtomicReference<>();Thread peer=new Thread(()->{
                    try(Socket socket=server.accept()){
                        socket.setSoTimeout(15000);DataInputStream in=new DataInputStream(socket.getInputStream());DataOutputStream out=new DataOutputStream(socket.getOutputStream());
                        String banner=String.format(java.util.Locale.ROOT,"RFB 003.%03d\n",minor);out.write(banner.getBytes(StandardCharsets.US_ASCII));out.flush();byte[] version=new byte[12];in.readFully(version);assertEquals(banner,new String(version,StandardCharsets.US_ASCII));
                        if(minor==3){out.writeInt(auth?2:1);out.flush();}else{out.writeByte(1);out.writeByte(auth?2:1);out.flush();assertEquals(auth?2:1,in.readUnsignedByte());}
                        if(auth){byte[] challenge=new byte[16];out.write(challenge);out.flush();byte[] response=new byte[16];in.readFully(response);out.writeInt(0);out.flush();}
                        assertEquals(1,in.readUnsignedByte());out.writeShort(1);out.writeShort(1);out.write(new byte[16]);out.writeInt(1);out.writeByte('x');out.flush();
                        byte[] config=new byte[28];in.readFully(config);assertEquals(3,in.readUnsignedByte());byte[] request=new byte[9];in.readFully(request);
                        out.writeByte(0);out.writeByte(0);out.writeShort(1);out.writeShort(0);out.writeShort(0);out.writeShort(1);out.writeShort(1);out.writeInt(0);out.write(new byte[]{0,0,0,0});out.flush();
                    }catch(Throwable ex){failure.set(ex);connected.countDown();}
                });peer.start();
                VncClient client=new VncClient(new VncClient.Listener(){public void connected(int w,int h,String name){}public void frame(int w,int h,int[] pixels){connected.countDown();}public void finished(String reason){}});
                try{client.start("127.0.0.1",server.getLocalPort(),auth?"password":"",!auth);assertTrue(connected.await(15,TimeUnit.SECONDS));}finally{client.stop();peer.join(5000);}if(failure.get()!=null)throw new AssertionError(failure.get());
            }
        }
    }
    @Test public void encodesUnicodeKeysymsAndRejectsControls() throws Exception {
        assertArrayEquals(new int[]{'A',0x0100042f,0x0101f642},VncClient.keysyms("AЯ🙂"));
        assertNull(VncClient.clipboardBytes("Привет"));assertArrayEquals(new byte[]{99,97,102,(byte)0xe9},VncClient.clipboardBytes("café"));assertNull(VncClient.keysyms("a\n"));assertNull(VncClient.keysyms("\ud800"));assertNull(VncClient.keysyms(""));
        assertEquals(3,VncClient.version("RFB 003.003\n"));assertEquals(7,VncClient.version("RFB 003.007\n"));assertEquals(8,VncClient.version("RFB 003.008\n"));
        try{VncClient.version("RFB 004.000\n");fail("unsupported version");}catch(IOException expected){}
    }
    @Test public void refusesAnonymousUnlessExplicitlyAllowed() throws Exception {
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){
            CountDownLatch finished=new CountDownLatch(1);AtomicReference<String> reason=new AtomicReference<>();Thread peer=new Thread(()->{try(Socket s=server.accept()){s.setSoTimeout(10000);DataInputStream in=new DataInputStream(s.getInputStream());DataOutputStream out=new DataOutputStream(s.getOutputStream());out.write("RFB 003.008\n".getBytes(StandardCharsets.US_ASCII));out.flush();byte[] b=new byte[12];in.readFully(b);out.write(new byte[]{1,1});out.flush();assertEquals(-1,in.read());}catch(Exception ignored){} });peer.start();
            VncClient client=new VncClient(new VncClient.Listener(){public void connected(int w,int h,String n){fail("anonymous access");}public void frame(int w,int h,int[] p){}public void finished(String why){reason.set(why);finished.countDown();}});
            try{client.start("127.0.0.1",server.getLocalPort(),"",false);assertTrue(finished.await(15,TimeUnit.SECONDS));assertTrue(reason.get().contains("Нет подходящего способа входа"));}finally{client.stop();peer.join(5000);}
        }
    }
}
