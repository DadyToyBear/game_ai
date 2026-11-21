package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ReverseSshTunnelTest {
    @Test public void validatesPortsAndCancelsBeforeConnection(){
        for(int value:new int[]{-1,0,65536}){
            try{new ReverseSshTunnel(value,80);fail("remote port");}catch(IllegalArgumentException expected){}
            try{new ReverseSshTunnel(80,value);fail("local port");}catch(IllegalArgumentException expected){}
        }
        ReverseSshTunnel tunnel=new ReverseSshTunnel(8000,8080);
        assertTrue(tunnel.isConnecting());assertFalse(tunnel.isRunning());
        assertTrue(tunnel.description().contains("8000"));assertTrue(tunnel.description().contains("8080"));
        tunnel.stop();tunnel.stop();assertFalse(tunnel.isConnecting());assertFalse(tunnel.isRunning());
    }
}
