package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Credentials;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import static org.junit.Assert.*;

/** Run with connectedAndroidTest on an emulator/device; no real server credentials are used. */
@RunWith(AndroidJUnit4.class)
public class WebDavClientTest {
    private MockWebServer server;
    @Before public void setUp() throws Exception { server=new MockWebServer();server.start(); }
    @After public void tearDown() throws Exception { server.shutdown(); }
    private WebDavClient.Connection connection() throws Exception {
        return WebDavClient.connection(server.url("/dav/").toString(),"user","password",false);
    }
    private static String response(String href,String properties,String status) {
        return "<d:response><d:href>"+href+"</d:href><d:propstat><d:prop>"+properties+"</d:prop><d:status>HTTP/1.1 "+status+"</d:status></d:propstat></d:response>";
    }
    @Test public void listsOnlyImmediateSuccessfulSameOriginResources() throws Exception {
        String dir="<d:displayname>Фото</d:displayname><d:resourcetype><d:collection/></d:resourcetype>";
        String file="<d:displayname>a &amp; b.txt</d:displayname><d:resourcetype/><d:getcontentlength>12</d:getcontentlength>";
        String xml="<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">"
            +response("/dav/",dir,"200 OK")
            +response("/dav/photos/",dir,"200 OK")
            +response("/dav/a.txt",file,"200 OK")
            +response("/dav/deep/file",file,"200 OK")
            +response("http://example.invalid/dav/leak",file,"200 OK")
            +response("/outside/file",file,"200 OK")
            +response("/dav/error",file,"404 Not Found")
            +"</d:multistatus>";
        server.enqueue(new MockResponse().setResponseCode(207).setBody(xml));
        WebDavClient.Connection conn=connection();WebDavClient.Listing listing=WebDavClient.list(conn,conn.root);
        assertEquals(2,listing.items.size());assertTrue(listing.items.get(0).directory);assertEquals("Фото",listing.items.get(0).name);
        assertEquals("a & b.txt",listing.items.get(1).name);assertEquals(12,listing.items.get(1).size);
        RecordedRequest request=server.takeRequest(5,TimeUnit.SECONDS);assertNotNull(request);assertEquals("PROPFIND",request.getMethod());
        assertEquals("1",request.getHeader("Depth"));assertEquals(Credentials.basic("user","password",java.nio.charset.StandardCharsets.UTF_8),request.getHeader("Authorization"));
    }
    @Test public void doesNotFollowRedirectsWithCredentials() throws Exception {
        try(MockWebServer other=new MockWebServer()){
            other.start();server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location",other.url("/secret")));
            WebDavClient.Connection conn=connection();
            try{WebDavClient.list(conn,conn.root);fail("Redirect must be refused");}catch(IOException expected){assertTrue(expected.getMessage().contains("302"));}
            assertNotNull(server.takeRequest(5,TimeUnit.SECONDS));assertNull(other.takeRequest(1,TimeUnit.SECONDS));
        }
    }
    @Test public void rejectsDoctype() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(207).setBody("<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><d:multistatus xmlns:d=\"DAV:\">&x;</d:multistatus>"));
        WebDavClient.Connection conn=connection();
        try{WebDavClient.list(conn,conn.root);fail("DOCTYPE must be refused");}catch(Exception expected){/* rejected */}
    }
    @Test public void rejectsUnsafeRootUrlsAndChildNames() throws Exception {
        for(String url:new String[]{"http://user:password@localhost/dav/","http://localhost/dav/%2e%2e/","http://localhost/dav/%2fsecret","http://localhost/dav/%252e%252e/","ftp://localhost/dav/"}){
            try{WebDavClient.connection(url,"u","p",false);fail("Accepted "+url);}catch(IOException expected){/* refused */}
        }
        WebDavClient.Connection conn=connection();
        for(String name:new String[]{"..","a/b","a\\b","%2e%2e"}){
            try{WebDavClient.child(conn,conn.root,name);fail("Accepted "+name);}catch(IOException expected){/* refused */}
        }
    }
}
