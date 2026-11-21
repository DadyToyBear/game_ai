package ru.aurora.filemanager;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;

/** Small, independent file manager based on Android's Storage Access Framework. */
public class MainActivity extends Activity {
    private static final int OPEN_TREE=1, SAVE_IMAGE=2, SFTP_DOWNLOAD=3, SFTP_UPLOAD=4, FTP_DOWNLOAD=5, FTP_UPLOAD=6, DAV_DOWNLOAD=7, DAV_UPLOAD=8, PAINT_OPEN_IMAGE=9, VIDEO_OPEN=10, VIDEO_SAVE=11, SMB_DOWNLOAD=12, SMB_UPLOAD=13, SSH_KEY_OPEN=14, SAVE_JPEG=15, SAVE_TEXT_COPY=16;
    private LinearLayout root, body;
    private Uri tree, current;
    private final Stack<Uri> parents = new Stack<>();
    private PaintView canvas;
    private boolean fileScreen, searchScreenVisible, propertiesVisible, bookmarkScreenVisible, zipScreenVisible;
    private FileSort.Mode fileSort=FileSort.Mode.NAME_ASC;
    private boolean showHiddenFiles=true;
    private boolean zipSelecting;private Uri zipSelectionFolder,zipSelectionTree;private final LinkedHashMap<Uri,Entry> zipSelected=new LinkedHashMap<>();
    private boolean mediaScreen;
    private VideoView mediaPlayer;
    private MediaController mediaController;
    private boolean mediaStopped;
    private Object mediaToken;
    private WebFilesServer webServer;
    private VncClient vncClient;private Runnable vncUiReset;
    private Entry clipboard; private boolean cut;
    private KeySshUi keySshUi;private android.os.CancellationSignal keySshCancel;
    private static final class KeySshUi {Uri key;String savedId;TextView status;boolean saving;}
    private Object bookmarksView;
    private Object textViewToken;
    private TextUi textUi;
    private PendingTextCopy pendingTextCopy;
    private static final class PendingTextCopy {Object token;TextUi state;Uri source;byte[] data;EditText editor;Button save,saveAs,find;}
    private static final class TextUi {boolean loading=true,saving;long revision,savedRevision;}
    private android.os.CancellationSignal zipCancellation;
    private Object accountsView;
    private Object trashView;
    private android.os.CancellationSignal scanCancellation;
    private android.os.CancellationSignal searchCancellation;
    private android.os.CancellationSignal hashCancellation;
    private android.os.CancellationSignal videoCancellation;
    private VideoUi videoUi; private PendingVideo pendingVideo;
    private static final class VideoUi { Uri source;EditText start,end;CheckBox mute;TextView status;Button choose,save,cancel,duration,previewButton;VideoView preview;Object durationRequest;boolean busy,previewReady; }
    private static final class PendingVideo { final VideoUi ui;final Uri source;final long start,end;final boolean mute;PendingVideo(VideoUi ui,Uri source,long start,long end,boolean mute){this.ui=ui;this.source=source;this.start=start;this.end=end;this.mute=mute;} }
    private SmbUi smbUi; private PendingSmb pendingSmb;
    private static final class SmbUi {EditText host,port,share,domain,user,password;TextView status;LinearLayout entries;Button list,upload;boolean busy;SmbAccess.Credentials connection;String directory;}
    private static final class PendingSmb {final SmbUi ui;final SmbAccess.Credentials connection;final String remote;final int request;PendingSmb(SmbUi ui,SmbAccess.Credentials connection,String remote,int request){this.ui=ui;this.connection=connection;this.remote=remote;this.request=request;}}
    private DavUi davUi; private PendingDav pendingDav;
    private static final class DavUi {EditText url,user,password;CheckBox anonymous;TextView status;LinearLayout entries;Button list,upload;boolean busy; WebDavClient.Connection connection;java.net.URI directory;}
    private static final class PendingDav {final DavUi ui;final WebDavClient.Connection connection;final java.net.URI remote;final int request;PendingDav(DavUi ui,WebDavClient.Connection connection,java.net.URI remote,int request){this.ui=ui;this.connection=connection;this.remote=remote;this.request=request;}}
    private FtpUi ftpUi; private PendingFtp pendingFtp;
    private static final class FtpUi {
        EditText host,port,user,password,path;CheckBox tls,anonymous;TextView status;LinearLayout entries;Button list,upload;boolean busy;
    }
    private static final class PendingFtp {
        final FtpUi ui;final FtpAccess.Credentials credentials;final String remote;final int request;
        PendingFtp(FtpUi ui,FtpAccess.Credentials credentials,String remote,int request){this.ui=ui;this.credentials=credentials;this.remote=remote;this.request=request;}
    }
    private SftpUi sftpUi;
    private InteractiveSsh interactiveSsh;
    private Runnable shellUiReset;
    private SshTunnel sshTunnel;
    private ReverseSshTunnel reverseTunnel;
    private TunnelUi reverseTunnelUi;
    private TunnelUi tunnelUi;
    private static final class TunnelUi { TextView status; Button start,stop; }
    private PendingSftp pendingSftp;
    private static final class SftpUi {
        EditText host,port,user,password,path; TextView status; LinearLayout entries; Button list,upload,auth; boolean busy; String keyId;
    }
    private static final class PendingSftp {
        final SftpUi ui; final SftpClient.Credentials credentials; final String remote; final int request;
        PendingSftp(SftpUi ui,SftpClient.Credentials credentials,String remote,int request){this.ui=ui;this.credentials=credentials;this.remote=remote;this.request=request;}
    }
    private int dp(float n) { return (int)(n * getResources().getDisplayMetrics().density + .5f); }
    @Override public void onCreate(Bundle state) { super.onCreate(state); home(); }
    private TextView text(String s, int size) { TextView t=new TextView(this); t.setText(s); t.setTextSize(size); t.setTextColor(Color.rgb(28,38,55)); return t; }
    private Button button(String label, Runnable action) { Button b=new Button(this); b.setText(label); b.setAllCaps(false); b.setOnClickListener(v -> action.run()); return b; }
    private void layout(String title) {
        stopVnc();vncUiReset=null;stopInteractiveSsh();shellUiReset=null;cancelScan();cancelSearch();cancelHash();cancelZip();cancelKeySsh();keySshUi=null;cancelVideo();videoUi=null;pendingVideo=null;trashView=null;accountsView=null;bookmarksView=null;textViewToken=null;textUi=null;pendingTextCopy=null;
        stopMedia();mediaToken=null;mediaScreen=false;canvas=null;
        sftpUi=null; pendingSftp=null; ftpUi=null; pendingFtp=null; davUi=null; pendingDav=null; smbUi=null; pendingSmb=null; tunnelUi=null; reverseTunnelUi=null;
        if(!"Файлы".equals(title))clearZipSelection();
        fileScreen="Файлы".equals(title);searchScreenVisible=false;propertiesVisible=false;bookmarkScreenVisible=false;zipScreenVisible=false;
        root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(18),dp(18),dp(18),dp(10)); root.setBackgroundColor(Color.rgb(247,249,252)); setContentView(root);
        TextView heading=text(title,26); heading.setTypeface(null,1); root.addView(heading);
        ScrollView scroll=new ScrollView(this); root.addView(scroll, new LinearLayout.LayoutParams(-1,0,1));
        body=new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(0,dp(16),0,0); scroll.addView(body);
    }
    private void note(String s) { TextView t=text(s,16); t.setPadding(0,dp(8),0,dp(8)); body.addView(t); }
    private void home() {
        layout("Aurora Files"); note("Файлы и инструменты · первая версия");
        body.addView(button("Открыть папку", () -> { Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION); startActivityForResult(i,OPEN_TREE); }));
        body.addView(button("Закладки папок", this::bookmarksScreen));
        body.addView(button("Корзина выбранной папки", this::trashScreen));
        body.addView(button("Анализ хранилища", this::storageScreen));
        body.addView(button("Управление приложениями", () -> {
            try { startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)); }
            catch(Exception ex) { error(ex); }
        }));
        body.addView(button("SSH — выполнить команду", this::sshScreen));
        body.addView(button("SSH — команда с ключом", this::sshKeyScreen));
        body.addView(button("SSH — интерактивная оболочка", this::interactiveSshScreen));
        body.addView(button("SFTP — удалённые файлы", this::sftpScreen));
        body.addView(button("FTP / FTPS — удалённые файлы", this::ftpScreen));
        body.addView(button("WebDAV — удалённые файлы", this::davClientScreen));
        body.addView(button("SMB3 — папки Windows / NAS", this::smbScreen));
        body.addView(button("SSH — проброс порта", this::tunnelScreen));
        body.addView(button("SSH — обратный проброс порта", this::reverseTunnelScreen));
        body.addView(button("Web-доступ к файлам", this::webScreen));
        body.addView(button("Удалённый рабочий стол · VNC", this::vncScreen));
        body.addView(button("Paint — рисование", this::paintScreen));
        body.addView(button("Видео — обрезка MP4", this::videoEditorScreen));
        body.addView(button("Проверка сети · ping", this::pingScreen));
        body.addView(button("О приложении", () -> { layout("О приложении"); note("Независимый файловый менеджер. Для доступа к файлам выберите папку в системном диалоге Android.\n\nSSH, SFTP, FTP/FTPS и WebDAV доступны в ограниченных версиях. Видеоредактор пока умеет только обрезать MP4; удалённый рабочий стол доступен как ограниченный VNC-клиент."); body.addView(button("Назад",this::home)); }));
    }
    @Override protected void onActivityResult(int req,int result,Intent data) {
        super.onActivityResult(req,result,data);
        if(req==SAVE_TEXT_COPY){
            PendingTextCopy pending=pendingTextCopy;pendingTextCopy=null;if(pending!=null&&pending.token==textViewToken&&pending.state==textUi){
                if(result==RESULT_OK&&data!=null&&data.getData()!=null)saveTextCopy(pending,data.getData());else finishTextCopy(pending,"Выбор файла отменён");
            }return;
        }
        if(req==SSH_KEY_OPEN){if(keySshUi!=null&&result==RESULT_OK&&data!=null&&data.getData()!=null){keySshUi.key=data.getData();keySshUi.savedId=null;keySshUi.status.setText("Ключ выбран. Перед входом проверьте отпечаток сервера.");}return;}
        if(req==VIDEO_OPEN){
            if(videoUi!=null && result==RESULT_OK && data!=null && data.getData()!=null){if(videoUi.preview!=null){videoUi.preview.stopPlayback();mediaStopped=true;videoUi.previewReady=false;videoUi.preview.setVisibility(View.GONE);}videoUi.source=data.getData();videoUi.previewButton.setEnabled(true);videoUi.durationRequest=null;videoUi.duration.setEnabled(true);videoUi.status.setText("Исходный видеофайл выбран. Укажите начало и конец в миллисекундах.");videoUi.save.setEnabled(true);}return;
        }
        if(req==VIDEO_SAVE){
            PendingVideo pending=pendingVideo;pendingVideo=null;
            if(pending!=null && pending.ui==videoUi && result==RESULT_OK && data!=null && data.getData()!=null)startVideoTrim(pending,data.getData());return;
        }
        if(req==SMB_DOWNLOAD || req==SMB_UPLOAD){
            PendingSmb pending=pendingSmb;pendingSmb=null;
            if(pending==null||pending.request!=req||result!=RESULT_OK||data==null||data.getData()==null||smbUi!=pending.ui)return;
            transferSmb(pending,data.getData());return;
        }
        if(req==DAV_DOWNLOAD || req==DAV_UPLOAD){
            PendingDav pending=pendingDav;pendingDav=null;
            if(pending==null||pending.request!=req||result!=RESULT_OK||data==null||data.getData()==null||davUi!=pending.ui)return;
            davWarning(pending.ui,pending.connection,()->transferDav(pending,data.getData()));return;
        }
        if(req==FTP_DOWNLOAD || req==FTP_UPLOAD){
            PendingFtp pending=pendingFtp;pendingFtp=null;
            if(pending==null || pending.request!=req || result!=RESULT_OK || data==null || data.getData()==null || ftpUi!=pending.ui)return;
            ftpWithWarning(pending.ui,pending.credentials,()->transferFtp(pending,data.getData()));return;
        }
        if(req==SFTP_DOWNLOAD || req==SFTP_UPLOAD){
            PendingSftp pending=pendingSftp;pendingSftp=null;
            if(pending==null || pending.request!=req || result!=RESULT_OK || data==null || data.getData()==null || sftpUi!=pending.ui)return;
            transferSftp(pending,data.getData());return;
        }
        if(result!=RESULT_OK || data==null || data.getData()==null) return;
        if(req==OPEN_TREE) { tree=data.getData(); clipboard=null; try { getContentResolver().takePersistableUriPermission(tree, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION)); } catch(SecurityException ignored) {} current=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)); parents.clear(); list(); }
        if(req==SAVE_IMAGE && canvas!=null) savePaint(data.getData(),canvas,false);
        if(req==SAVE_JPEG && canvas!=null) savePaint(data.getData(),canvas,true);
        if(req==PAINT_OPEN_IMAGE && canvas!=null) loadPaint(data.getData(),canvas);
    }
    private void list() {
        layout("Файлы");if(zipSelecting&&(!Objects.equals(current,zipSelectionFolder)||!Objects.equals(tree,zipSelectionTree)))clearZipSelection();
        body.addView(button("← Назад", () -> { if(zipSelecting){clearZipSelection();list();}else if(parents.empty()) home(); else {current=parents.pop(); list();} }));
        if(zipSelecting){
            note("Выберите до 100 элементов в текущей папке. Длительное нажатие и нажатие переключают выбор. Исходники не удаляются.");
            body.addView(button("Создать ZIP из выбранных: "+zipSelected.size(),this::zipSelectedItems));
            body.addView(button("Отменить выбор",()->{clearZipSelection();list();}));
        }else body.addView(button("Выбрать несколько для ZIP",()->{zipSelecting=true;zipSelectionFolder=current;zipSelectionTree=tree;zipSelected.clear();list();}));
        if(!zipSelecting){
        body.addView(button("Поиск в этой папке",this::searchScreen));
        body.addView(button(showHiddenFiles?"Скрыть имена с точкой":"Показать имена с точкой",()->{showHiddenFiles=!showHiddenFiles;list();}));
        body.addView(button("Добавить папку в закладки",this::addCurrentBookmark));
        body.addView(button("Сортировка: "+sortLabel(fileSort),()->{
            String[] labels={"Имя: А–Я", "Имя: Я–А", "Размер: сначала большие", "Размер: сначала маленькие"};
            new AlertDialog.Builder(this).setTitle("Сортировка файлов").setSingleChoiceItems(labels,fileSort.ordinal(),(dialog,choice)->{fileSort=FileSort.Mode.values()[choice];dialog.dismiss();list();}).setNegativeButton("Отмена",null).show();
        }));
        if(clipboard!=null){body.addView(button((cut?"Вставить (переместить): ":"Вставить (копировать): ")+clipboard.name, this::paste));body.addView(button("Очистить выбранный для вставки элемент",()->{clipboard=null;list();}));}
        body.addView(button("＋ Новый текстовый файл",()->input("Имя текстового файла",name->{
            Uri dest=current,selectedTree=tree;String fileName;try{fileName=FileOperations.textName(name);}catch(Exception ex){error(ex);return;}
            toast("Создание файла…");new Thread(()->{FileOperations.Item created=null;String problem=null;try{created=new FileOperations(getContentResolver(),selectedTree).createEmptyText(dest,fileName);}catch(Exception ex){problem=ex.getMessage();}
                FileOperations.Item answer=created;String failure=problem;runOnUiThread(()->{if(isFinishing()||isDestroyed())return;if(failure!=null)toast("Ошибка: "+failure);else toast("Создано: "+answer.name+". Откройте файл для редактирования.");if(fileScreen&&dest.equals(current)&&selectedTree.equals(tree))list();});
            },"create-text").start();
        })));
        body.addView(button("＋ Новая папка", () -> input("Имя папки", name -> { try { if(DocumentsContract.createDocument(getContentResolver(),current,DocumentsContract.Document.MIME_TYPE_DIR,name)==null) throw new IOException("Создание не поддерживается"); list(); } catch(Exception e){error(e);} })));
        }
        try {
            String id=DocumentsContract.getDocumentId(current); Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,id);
            ArrayList<Entry> entries=new ArrayList<>();
            try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)) {
                if(c==null) throw new IOException("Папка недоступна");
                while(c.moveToNext()) entries.add(new Entry(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)),c.getString(1),c.getString(2),c.isNull(3)?-1:c.getLong(3)));
            }
            Collections.sort(entries,FileSort.comparator(fileSort));
            int hidden=0;for(Entry e:entries)if(!FileVisibility.show(e.name,showHiddenFiles))hidden++;
            if(entries.isEmpty())note("Папка пуста");else if(hidden==entries.size())note("Нет видимых элементов; имена с точкой скрыты.");
            for(Entry e:entries) { if(!FileVisibility.show(e.name,showHiddenFiles))continue;
                String prefix=zipSelecting?(zipSelected.containsKey(e.uri)?"☑  ":"☐  "):(e.dir()?"📁  ":"📄  ");
                TextView row=text(prefix+e.name+(e.dir()||e.size<0?"":"  ·  "+android.text.format.Formatter.formatFileSize(this,e.size)),16);row.setPadding(dp(8),dp(16),dp(8),dp(16));body.addView(row);
                row.setOnClickListener(v->{if(zipSelecting){toggleZipEntry(e);return;}if(e.dir()){parents.push(current);current=e.uri;list();}else open(e);});
                row.setOnLongClickListener(v->{if(zipSelecting)toggleZipEntry(e);else actions(e);return true;});
            }
        } catch(Exception e) { error(e); }
    }
    private void clearZipSelection(){zipSelecting=false;zipSelectionTree=null;zipSelectionFolder=null;zipSelected.clear();}
    private void toggleZipEntry(Entry entry){if(zipSelected.containsKey(entry.uri))zipSelected.remove(entry.uri);else if(zipSelected.size()>=100){toast("Можно выбрать не более 100 элементов");return;}else zipSelected.put(entry.uri,entry);list();}
    private void zipSelectedItems(){
        if(!zipSelecting||zipSelected.isEmpty()){toast("Выберите хотя бы один элемент");return;}Uri destination=zipSelectionFolder,selectedTree=zipSelectionTree;List<FileOperations.Item> selected=new ArrayList<>();
        for(Entry e:zipSelected.values())selected.add(new FileOperations.Item(e.uri,e.name,e.mime));
        input("Имя нового ZIP-архива",name->{if(!zipSelecting||!Objects.equals(destination,current)||!Objects.equals(selectedTree,tree))return;
            String archive=name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")?name:name+".zip";clearZipSelection();list();
            runFileTask(()->new FileOperations(getContentResolver(),selectedTree).zipMany(selected,destination,archive),"ZIP-архив создан");
        });
    }
    private String sortLabel(FileSort.Mode mode){switch(mode){case NAME_DESC:return "имя Я–А";case SIZE_DESC:return "сначала большие";case SIZE_ASC:return "сначала маленькие";default:return "имя А–Я";}}
    private void open(Entry e) {
        if(isText(e)){editText(e);return;}
        String mime=mediaMime(e);
        if(mime.startsWith("image/")){imageScreen(e);return;}
        if(mime.startsWith("video/")||mime.startsWith("audio/")){playerScreen(e,mime);return;}
        openExternal(e);
    }
    private void openExternal(Entry e) {
        try { Intent i=new Intent(Intent.ACTION_VIEW);i.setDataAndType(e.uri,mediaMime(e));i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(i); }
        catch(Exception ex){error(ex);}
    }
    private void imageScreen(Entry entry) {
        layout("Изображение · "+entry.name);mediaScreen=true;Object token=new Object();mediaToken=token;
        note("Предпросмотр уменьшен для экономии памяти. Увеличение показывает эту уменьшенную копию; после увеличения её можно перетаскивать одним пальцем. Для неподдерживаемых форматов используйте другое приложение.");
        TextView status=text("Загрузка…",15);body.addView(status);
        ZoomImageView image=new ZoomImageView(this);body.addView(image,new LinearLayout.LayoutParams(-1,dp(400)));
        LinearLayout zoomControls=new LinearLayout(this);body.addView(zoomControls);zoomControls.addView(button("−",()->image.setZoom(image.getZoom()/1.5f)));zoomControls.addView(button("+",()->image.setZoom(image.getZoom()*1.5f)));zoomControls.addView(button("Сброс",image::reset));
        body.addView(button("Редактировать в Paint",()->{paintScreen();if(canvas!=null)loadPaint(entry.uri,canvas);}));
        body.addView(button("Открыть в другом приложении",()->openExternal(entry)));body.addView(button("Назад",this::list));
        new Thread(()->{
            Bitmap bitmap=null;String failure=null;
            try{bitmap=ImagePreview.load(getContentResolver(),entry.uri);}catch(Exception | OutOfMemoryError ex){failure=ex.getMessage()==null?"Недостаточно памяти":ex.getMessage();}
            Bitmap result=bitmap;String errorMessage=failure;
            runOnUiThread(()->{
                if(mediaToken!=token||isFinishing()||isDestroyed()){if(result!=null)result.recycle();return;}
                if(result==null)status.setText("Не удалось открыть изображение: "+errorMessage);
                else{image.setImageBitmap(result);status.setText("Предпросмотр · "+result.getWidth()+" × "+result.getHeight());}
            });
        },"image-preview").start();
    }
    private void playerScreen(Entry entry,String mime) {
        layout((mime.startsWith("audio/")?"Аудио · ":"Видео · ")+entry.name);mediaScreen=true;
        note("Воспроизведение использует системные кодеки. Нажмите на область плеера для управления. При уходе с экрана воспроизведение останавливается.");
        TextView status=text("Подготовка…",15);body.addView(status);
        final android.media.MediaPlayer[] engine={null};final int[] speedIndex={2};
        VideoView player=new VideoView(this);mediaPlayer=player;mediaStopped=false;
        body.addView(player,new LinearLayout.LayoutParams(-1,dp(mime.startsWith("audio/")?160:300)));
        MediaController controls=new MediaController(this);mediaController=controls;controls.setAnchorView(player);player.setMediaController(controls);
        player.setOnPreparedListener(mp->{if(mediaPlayer!=player)return;engine[0]=mp;status.setText("Готово · управление доступно в плеере");player.start();try{mp.setPlaybackParams(mp.getPlaybackParams().setSpeed(MediaSpeed.VALUES[speedIndex[0]]));}catch(Exception ex){speedIndex[0]=2;status.setText("Скорость недоступна для этого файла или устройства");}controls.show(3000);});
        player.setOnCompletionListener(mp->{if(mediaPlayer==player)status.setText("Воспроизведение завершено");});
        player.setOnErrorListener((mp,what,extra)->{if(mediaPlayer==player){engine[0]=null;status.setText("Не удалось воспроизвести файл. Попробуйте другое приложение.");}return true;});
        body.addView(button("Воспроизвести / заново",()->{if(mediaPlayer!=player)return;if(mediaStopped){mediaStopped=false;status.setText("Подготовка…");player.setVideoURI(entry.uri);}else{player.start();controls.show(3000);}}));
        body.addView(button("Скорость воспроизведения",()->{
            if(mediaPlayer!=player||mediaStopped||engine[0]==null){toast("Сначала запустите воспроизведение");return;}
            new AlertDialog.Builder(this).setTitle("Скорость воспроизведения").setSingleChoiceItems(MediaSpeed.LABELS,speedIndex[0],(dialog,index)->{
                dialog.dismiss();if(mediaPlayer!=player||mediaStopped||engine[0]==null)return;
                try{boolean playing=player.isPlaying();engine[0].setPlaybackParams(engine[0].getPlaybackParams().setSpeed(MediaSpeed.VALUES[index]));if(!playing)player.pause();speedIndex[0]=index;status.setText("Скорость: "+MediaSpeed.LABELS[index]);}
                catch(Exception ex){status.setText("Эта скорость недоступна на устройстве: "+ex.getMessage());}
            }).setNegativeButton("Отмена",null).show();
        }));
        body.addView(button("Открыть в другом приложении",()->openExternal(entry)));body.addView(button("Назад",this::list));
        player.setVideoURI(entry.uri);
    }
    private void stopMedia(){
        if(mediaController!=null){mediaController.hide();mediaController=null;}
        if(mediaPlayer!=null){mediaPlayer.stopPlayback();mediaPlayer=null;}
        mediaStopped=true;
    }
    private String mediaMime(Entry e) {
        if(!e.mime.equals("application/octet-stream"))return e.mime;
        String lower=e.name.toLowerCase(java.util.Locale.ROOT);int dot=lower.lastIndexOf('.');
        String extension=dot<0?"":lower.substring(dot+1);
        String mime=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        if(mime==null && extension.equals("wav"))mime="audio/wav";
        if(mime==null && extension.equals("mp3"))mime="audio/mpeg";
        if(mime==null && extension.equals("mp4"))mime="video/mp4";
        return mime==null?e.mime:mime;
    }
    private boolean isText(Entry e) { String n=e.name.toLowerCase(java.util.Locale.ROOT); return e.mime.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".md") || n.endsWith(".json") || n.endsWith(".xml") || n.endsWith(".csv") || n.endsWith(".log"); }
    private void actions(Entry e) {
        String[] choices={"Открыть", "Копировать", "Вырезать", "Сжать в ZIP", "Распаковать ZIP", "Переименовать", "В корзину", "Удалить навсегда", "Поделиться", "Свойства", "Посмотреть ZIP"};
        new AlertDialog.Builder(this).setTitle(e.name).setItems(choices,(d,n)->{
            if(n==0){if(e.dir()){parents.push(current);current=e.uri;list();}else open(e);}
            if(n==1||n==2){clipboard=e;cut=n==2;toast(cut?"Выбрано для перемещения":"Выбрано для копирования");list();}
            if(n==3) input("Имя ZIP-архива",name->{Uri dest=current;Uri selectedTree=tree;runFileTask(()->new FileOperations(getContentResolver(),selectedTree).zip(new FileOperations.Item(e.uri,e.name,e.mime),dest,name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")?name:name+".zip"),"Архив создан");});
            if(n==4){if(e.dir()||!e.name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")){toast("Выберите ZIP-файл");return;} input("Имя новой папки",name->{Uri dest=current;Uri selectedTree=tree;runFileTask(()->new FileOperations(getContentResolver(),selectedTree).unzip(new FileOperations.Item(e.uri,e.name,e.mime),dest,name),"Архив распакован");});}
            if(n==5) input("Новое имя",name->{try{if(DocumentsContract.renameDocument(getContentResolver(),e.uri,name)==null)throw new IOException("Переименование не поддерживается");list();}catch(Exception ex){error(ex);}});
            if(n==6){Uri selectedTree=tree,parent=current;if(clipboard!=null&&clipboard.uri.equals(e.uri))clipboard=null;runFileTask(()->new TrashStore(this).moveToTrash(selectedTree,parent,e.uri),"Перемещено в корзину");}
            if(n==7) new AlertDialog.Builder(this).setMessage("Удалить «"+e.name+"» навсегда, минуя корзину? Операция необратима.").setNegativeButton("Отмена",null).setPositiveButton("Удалить",(x,y)->{try{if(!DocumentsContract.deleteDocument(getContentResolver(),e.uri))throw new IOException("Удаление не поддерживается");list();}catch(Exception ex){error(ex);}}).show();
            if(n==9)propertiesScreen(e);
            if(n==10){if(e.dir()||!e.name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")){toast("Выберите ZIP-файл");return;}zipScreen(e);}
            if(n==8 && !e.dir()){Intent i=new Intent(Intent.ACTION_SEND);i.setType(e.mime);i.putExtra(Intent.EXTRA_STREAM,e.uri);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"Поделиться"));}
        }).show();
    }
    private void cancelZip(){if(zipCancellation!=null){zipCancellation.cancel();zipCancellation=null;}}
    private void zipScreen(Entry entry){
        layout("Содержимое ZIP");zipScreenVisible=true;note("Предпросмотр без распаковки. Он читает содержимое архива, но ничего не сохраняет. Показаны не более 500 записей и прочитано не более 64 МиБ распакованных данных; зашифрованные ZIP и некоторые форматы не поддерживаются.");
        TextView status=text("Чтение…",15);body.addView(status);LinearLayout rows=new LinearLayout(this);rows.setOrientation(LinearLayout.VERTICAL);body.addView(rows);Button cancel=button("Отменить чтение",()->{});body.addView(cancel);body.addView(button("Назад к файлам",this::list));
        android.os.CancellationSignal signal=new android.os.CancellationSignal();zipCancellation=signal;
        cancel.setOnClickListener(v->{cancelZip();cancel.setEnabled(false);status.setText("Отменено. Провайдер может остановить чтение не сразу.");});
        new Thread(()->{ZipPreview.Result found=null;String failure=null;
            try(android.content.res.AssetFileDescriptor afd=getContentResolver().openAssetFileDescriptor(entry.uri,"r",signal)){if(afd==null)throw new IOException("Архив недоступен");try(InputStream input=afd.createInputStream()){found=ZipPreview.list(input,signal);}}
            catch(android.os.OperationCanceledException ignored){}catch(Exception ex){failure=ex.getMessage();}
            ZipPreview.Result answer=found;String error=failure;runOnUiThread(()->{
                if(zipCancellation!=signal||isFinishing()||isDestroyed())return;zipCancellation=null;cancel.setEnabled(false);
                if(answer==null){status.setText("Не удалось прочитать ZIP: "+error);return;}
                status.setText("Записей: "+answer.items.size()+" · прочитано данных: "+android.text.format.Formatter.formatFileSize(this,answer.scanned)+(answer.limited?"\nСписок неполный: достигнут лимит.":""));
                for(ZipPreview.Item item:answer.items){TextView row=text((item.unsafe?"⚠ ":item.directory?"📁 ":"📄 ")+item.name+(item.directory?"":" · "+android.text.format.Formatter.formatFileSize(this,item.bytes)),15);row.setPadding(dp(6),dp(8),dp(6),dp(8));rows.addView(row);}
            });
        },"zip-preview").start();
    }
    private void cancelHash(){if(hashCancellation!=null){hashCancellation.cancel();hashCancellation=null;}}
    private void propertiesScreen(Entry entry){
        layout("Свойства");propertiesVisible=true;note("Имя: "+entry.name+"\nТип: "+(entry.dir()?"Папка":entry.mime)+"\nРазмер: "+(entry.dir()?"не вычисляется":entry.size<0?"неизвестен":android.text.format.Formatter.formatFileSize(this,entry.size)+" ("+entry.size+" байт)"));
        note("Сведения получены от провайдера и могут измениться. Контрольная сумма вычисляется только для файлов; если файл изменяется во время чтения, результат может не соответствовать его текущему состоянию.");
        TextView result=text("",15);result.setTextIsSelectable(true);Button start=button("Вычислить SHA-256",()->{}),cancel=button("Отменить вычисление",()->{}),copy=button("Скопировать SHA-256",()->{});start.setEnabled(!entry.dir());cancel.setEnabled(false);copy.setEnabled(false);
        body.addView(start);body.addView(cancel);body.addView(copy);body.addView(result);body.addView(button("Назад к файлам",this::list));
        final String[] hash={null};
        start.setOnClickListener(v->{cancelHash();android.os.CancellationSignal signal=new android.os.CancellationSignal();hashCancellation=signal;hash[0]=null;start.setEnabled(false);cancel.setEnabled(true);copy.setEnabled(false);result.setText("Чтение файла…");
            new Thread(()->{FileDigest.Result computed=null;String error=null;
                try(android.content.res.AssetFileDescriptor afd=getContentResolver().openAssetFileDescriptor(entry.uri,"r",signal)){
                    if(afd==null)throw new IOException("Файл недоступен");try(InputStream in=afd.createInputStream()){computed=FileDigest.sha256(in,signal);}
                }catch(android.os.OperationCanceledException ignored){}catch(Exception ex){error=ex.getMessage();}
                FileDigest.Result answer=computed;String failure=error;runOnUiThread(()->{
                    if(hashCancellation!=signal||isDestroyed()||isFinishing())return;hashCancellation=null;start.setEnabled(true);cancel.setEnabled(false);
                    if(answer==null){result.setText("Не удалось вычислить SHA-256: "+failure);return;}hash[0]=answer.sha256;copy.setEnabled(true);result.setText("SHA-256: "+answer.sha256+"\nПрочитано байт: "+answer.bytes);
                });
            },"file-sha256").start();
        });
        cancel.setOnClickListener(v->{cancelHash();start.setEnabled(true);cancel.setEnabled(false);result.setText("Отменено; чтение может остановиться не сразу, если провайдер не поддерживает отмену.");});
        copy.setOnClickListener(v->{if(hash[0]!=null){android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);clipboard.setPrimaryClip(ClipData.newPlainText("SHA-256",hash[0]));toast("SHA-256 скопирован");}});
    }
    private boolean hasBookmarkPermission(Uri selectedTree){
        for(android.content.UriPermission permission:getContentResolver().getPersistedUriPermissions())if(permission.isReadPermission()&&permission.getUri().equals(selectedTree))return true;return false;
    }
    private void addCurrentBookmark(){
        if(tree==null||current==null)return;Uri selectedTree=tree,folder=current;
        if(!hasBookmarkPermission(selectedTree)){toast("Постоянный доступ к папке не предоставлен. Выберите её заново через Android.");return;}
        input("Название закладки (до 80 символов)",name->{
            new Thread(()->{String failure=null;try{new BookmarkStore(getApplicationContext()).add(name,selectedTree,folder);}catch(Exception ex){failure=ex.getMessage();}String problem=failure;
                runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())toast(problem==null?"Закладка добавлена":"Ошибка закладки: "+problem);});
            },"bookmark-add").start();
        });
    }
    private void bookmarksScreen(){
        layout("Закладки папок");bookmarkScreenVisible=true;Object token=new Object();bookmarksView=token;
        note("Закладки ссылаются на выбранные через Android папки. Если разрешение отозвано или папка перемещена, выберите её заново. Удаление закладки не удаляет папку и не отзывает доступ.");
        TextView status=text("Загрузка…",15);body.addView(status);LinearLayout rows=new LinearLayout(this);rows.setOrientation(LinearLayout.VERTICAL);body.addView(rows);body.addView(button("Назад",this::home));
        new Thread(()->{List<BookmarkStore.Bookmark> values=null;String failure=null;try{values=new BookmarkStore(getApplicationContext()).list();}catch(Exception ex){failure=ex.getMessage();}
            List<BookmarkStore.Bookmark> items=values;String problem=failure;runOnUiThread(()->{
                if(bookmarksView!=token||isFinishing()||isDestroyed())return;if(problem!=null){status.setText("Ошибка: "+problem);return;}status.setText(items.isEmpty()?"Нет закладок":"Закладок: "+items.size());
                for(BookmarkStore.Bookmark item:items)rows.addView(button("📁 "+item.name,()->new AlertDialog.Builder(this).setTitle(item.name).setItems(new String[]{"Открыть", "Удалить закладку"},(d,which)->{
                    if(which==0){if(!hasBookmarkPermission(item.tree)){toast("Доступ отозван: выберите папку заново");return;}tree=item.tree;current=item.document;clipboard=null;parents.clear();list();}
                    else new AlertDialog.Builder(this).setMessage("Удалить закладку? Папка и файлы останутся без изменений.").setNegativeButton("Отмена",null).setPositiveButton("Удалить",(x,y)->{
                        new Thread(()->{String error=null;try{new BookmarkStore(getApplicationContext()).remove(item.id);}catch(Exception ex){error=ex.getMessage();}String err=error;runOnUiThread(()->{if(bookmarksView!=token||isDestroyed())return;if(err!=null)toast("Ошибка: "+err);else bookmarksScreen();});},"bookmark-remove").start();
                    }).show();
                }).setNegativeButton("Отмена",null).show()));
            });
        },"bookmark-list").start();
    }
    private void trashScreen(){
        layout("Корзина");Object token=new Object();trashView=token;
        note("Корзина относится только к последней выбранной папке. Файлы хранятся в отдельной папке этого хранилища, а сведения для восстановления — в данных приложения. Не удаляйте эту папку и данные приложения, если они нужны.");
        if(tree==null){note("Сначала выберите папку на главном экране.");body.addView(button("Назад",this::home));return;}
        Uri selectedTree=tree;TextView status=text("Загрузка…",15);body.addView(status);LinearLayout entries=new LinearLayout(this);entries.setOrientation(LinearLayout.VERTICAL);body.addView(entries);body.addView(button("Назад",this::home));
        new Thread(()->{
            TrashStore.Snapshot snapshot=null;String failure=null;try{snapshot=new TrashStore(this).list(selectedTree);}catch(Exception ex){failure=ex.getMessage();}
            TrashStore.Snapshot result=snapshot;String problem=failure;
            runOnUiThread(()->{
                if(trashView!=token||isFinishing()||isDestroyed())return;
                if(result==null){status.setText("Корзина недоступна: "+problem);return;}
                status.setText(result.records.isEmpty()?"Нет записей корзины":"Элементов: "+result.records.size());
                if(result.trash!=null)entries.addView(button("Открыть папку корзины вручную",()->{tree=selectedTree;current=result.trash;parents.clear();list();}));
                for(TrashStore.Record record:result.records){
                    boolean ready=record.state.equals("ready")&&record.moved!=null;
                    entries.addView(button((ready?"🗑 ":"⚠ ")+record.name+(ready?"":" · состояние неизвестно"),()->trashActions(selectedTree,record)));
                }
            });
        },"trash-list").start();
    }
    private void trashActions(Uri selectedTree,TrashStore.Record record){
        boolean ready=record.state.equals("ready")&&record.moved!=null;
        if(!ready){
            new AlertDialog.Builder(this).setTitle(record.name).setMessage("Предыдущая операция не завершилась или её результат неизвестен. Проверьте исходную папку и папку корзины вручную. Удаление записи не удаляет файл.")
                .setNegativeButton("Закрыть",null).setPositiveButton("Убрать запись",(d,w)->new AlertDialog.Builder(this).setMessage("Убрать только запись? Это не восстановит и не удалит файл.")
                    .setNegativeButton("Отмена",null).setPositiveButton("Убрать",(x,y)->trashTask(()->new TrashStore(this).forget(selectedTree,record.id),"Запись убрана")).show()).show();return;
        }
        new AlertDialog.Builder(this).setTitle(record.name).setItems(new String[]{"Восстановить", "Удалить навсегда"},(d,n)->{
            if(n==0)trashTask(()->new TrashStore(this).restore(selectedTree,record.id),"Восстановлено");
            else new AlertDialog.Builder(this).setMessage("Удалить «"+record.name+"» навсегда? Операция необратима.")
                .setNegativeButton("Отмена",null).setPositiveButton("Удалить",(x,y)->trashTask(()->new TrashStore(this).deletePermanently(selectedTree,record.id),"Удалено навсегда")).show();
        }).show();
    }
    private void trashTask(FileTask task,String success){
        Object token=trashView;toast("Операция выполняется…");new Thread(()->{String message=success;try{task.run();}catch(Exception ex){message="Ошибка: "+ex.getMessage();}String answer=message;
            runOnUiThread(()->{if(!isFinishing()&&!isDestroyed()){toast(answer);if(trashView==token&&token!=null)trashScreen();}});
        },"trash-operation").start();
    }
    interface FileTask { void run() throws Exception; }
    private void runFileTask(FileTask task,String success) {
        toast("Операция выполняется…"); new Thread(()->{String message=success;try{task.run();}catch(Exception ex){message="Ошибка: "+ex.getMessage();}String answer=message;runOnUiThread(()->{if(!isFinishing()&&!isDestroyed()){toast(answer);if(fileScreen)list();}});},"file-operation").start();
    }
    private void paste() {
        Entry selected=clipboard; if(selected==null)return;
        if(selected.dir() && (selected.uri.equals(current)||parents.contains(selected.uri))){toast("Нельзя вставить папку внутрь самой себя");return;}
        Uri dest=current, selectedTree=tree; boolean move=cut; clipboard=null;
        runFileTask(()->{FileOperations ops=new FileOperations(getContentResolver(),selectedTree);ops.copy(new FileOperations.Item(selected.uri,selected.name,selected.mime),dest); if(move){try{if(!DocumentsContract.deleteDocument(getContentResolver(),selected.uri))throw new IOException("Удаление не поддерживается");}catch(Exception ex){throw new IOException("Копия создана, но исходный объект не удалён: "+ex.getMessage(),ex);}}},move?"Перемещение завершено":"Копирование завершено");
    }
    private void editText(Entry entry) {
        layout("Текст · "+entry.name);Object token=new Object();textViewToken=token;TextUi state=new TextUi();textUi=state; note("UTF-8, максимум 1 МиБ. Сохранение перезаписывает исходный файл; рекомендуется сделать копию. Поворот экрана может привести к потере несохранённого текста.");
        EditText editor=new EditText(this);editor.setGravity(Gravity.TOP|Gravity.START);editor.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);editor.setMinLines(12);editor.setTextSize(18);editor.setEnabled(false);body.addView(editor);
        TextView fontLabel=text("Размер текста: 18 sp",15);body.addView(fontLabel);SeekBar fontSize=new SeekBar(this);fontSize.setMax(16);fontSize.setProgress(4);body.addView(fontSize);
        fontSize.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar bar,int value,boolean user){int size=14+value;editor.setTextSize(size);fontLabel.setText("Размер текста: "+size+" sp");}public void onStartTrackingTouch(SeekBar bar){}public void onStopTrackingTouch(SeekBar bar){}});
        editor.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){if(!state.loading)state.revision++;}public void afterTextChanged(android.text.Editable e){}});
        EditText find=field("Найти в тексте (до 256 символов)",false);Button findNext=button("Найти далее",()->{String query=find.getText().toString();if(query.isEmpty()||query.length()>256){toast("Введите от 1 до 256 символов");return;}int index=TextFind.next(editor.getText().toString(),query,Math.max(0,editor.getSelectionEnd()));if(index<0){toast("Совпадений нет");return;}editor.requestFocus();editor.setSelection(index,index+query.length());});findNext.setEnabled(false);body.addView(findNext);
        body.addView(button("Перейти к строке",()->{if(state.loading||state.saving)return;input("Номер строки (от 1)",value->{if(textUi!=state||state.loading||state.saving)return;try{int line=Integer.parseInt(value.trim());int offset=TextFind.lineStart(editor.getText(),line);if(offset<0){toast("Такой строки нет");return;}editor.requestFocus();editor.setSelection(offset);}catch(NumberFormatException ex){toast("Введите корректный номер строки");}});}));
        Button save=button("Сохранить",()->{}),saveAs=button("Сохранить копию как…",()->{});save.setEnabled(false);saveAs.setEnabled(false);body.addView(save);body.addView(saveAs);body.addView(button("Назад",()->leaveText(state)));
        new Thread(()->{try(InputStream in=getContentResolver().openInputStream(entry.uri)){if(in==null)throw new IOException("Файл недоступен");ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>1048576)throw new IOException("Файл больше 1 МиБ");out.write(b,0,n);}String value=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();runOnUiThread(()->{if(textViewToken==token&&!isFinishing()&&!isDestroyed()){editor.setText(value);state.loading=false;state.savedRevision=state.revision;editor.setEnabled(true);save.setEnabled(true);saveAs.setEnabled(true);findNext.setEnabled(true);}});}catch(Exception ex){runOnUiThread(()->{if(textViewToken==token&&!isDestroyed())error(ex);});}},"text-read").start();
        saveAs.setOnClickListener(v->{
            if(state.saving||state.loading)return;byte[] data=editor.getText().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(data.length>1048576){toast("Текст больше 1 МиБ");return;}
            new AlertDialog.Builder(this).setTitle("Сохранить копию").setMessage("Выберите новое имя и не выбирайте исходный файл. Системный диалог может разрешить перезаписать существующий файл; разные ссылки могут указывать на один файл.")
                .setNegativeButton("Отмена",null).setPositiveButton("Выбрать",(d,w)->{
                    if(textUi!=state||state.saving)return;PendingTextCopy pending=new PendingTextCopy();pending.token=token;pending.state=state;pending.source=entry.uri;pending.data=data;pending.editor=editor;pending.save=save;pending.saveAs=saveAs;pending.find=findNext;
                    state.saving=true;editor.setEnabled(false);save.setEnabled(false);saveAs.setEnabled(false);findNext.setEnabled(false);pendingTextCopy=pending;
                    Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("text/plain");intent.putExtra(Intent.EXTRA_TITLE,"copy.txt");
                    try{startActivityForResult(intent,SAVE_TEXT_COPY);}catch(Exception ex){pendingTextCopy=null;finishTextCopy(pending,"Не удалось выбрать файл: "+ex.getMessage());}
                }).show();
        });
        save.setOnClickListener(v->{
            if(state.saving||state.loading)return;byte[] data=editor.getText().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(data.length>1048576){toast("Текст больше 1 МиБ");return;}
            state.saving=true;save.setEnabled(false);saveAs.setEnabled(false);editor.setEnabled(false);findNext.setEnabled(false);
            new Thread(()->{String failure=null;try(OutputStream out=getContentResolver().openOutputStream(entry.uri,"wt")){if(out==null)throw new IOException("Запись недоступна");out.write(data);}catch(Exception ex){failure=ex.getMessage()==null?ex.toString():ex.getMessage();}
                String problem=failure;runOnUiThread(()->{if(textViewToken!=token||isDestroyed())return;state.saving=false;editor.setEnabled(true);save.setEnabled(true);saveAs.setEnabled(true);findNext.setEnabled(true);
                    if(problem==null){state.savedRevision=state.revision;toast("Сохранено");}else toast("Ошибка сохранения; файл мог быть изменён: "+problem);
                });
            },"text-save").start();
        });
    }
    private void finishTextCopy(PendingTextCopy pending,String message){
        if(textViewToken!=pending.token||textUi!=pending.state||isDestroyed())return;pending.state.saving=false;pending.editor.setEnabled(true);pending.save.setEnabled(true);pending.saveAs.setEnabled(true);pending.find.setEnabled(true);toast(message);
    }
    private void saveTextCopy(PendingTextCopy pending,Uri destination){
        try{TextCopy.validateTarget(pending.source,destination);}catch(Exception ex){finishTextCopy(pending,ex.getMessage());return;}
        new Thread(()->{String failure=null;try(OutputStream out=getContentResolver().openOutputStream(destination,"wt")){if(out==null)throw new IOException("Файл назначения недоступен");out.write(pending.data);}catch(Exception ex){failure=ex.getMessage()==null?ex.toString():ex.getMessage();}
            String error=failure;runOnUiThread(()->finishTextCopy(pending,error==null?"Копия сохранена. Редактор остаётся привязан к исходному файлу.":"Ошибка: "+error+". Файл назначения может быть неполным."));
        },"text-copy-save").start();
    }
    private void leaveText(TextUi state){
        if(textUi!=state)return;if(state.saving){toast("Дождитесь завершения сохранения");return;}
        if(state.revision==state.savedRevision){list();return;}
        new AlertDialog.Builder(this).setTitle("Несохранённые изменения").setMessage("Выйти без сохранения? Изменения текста будут потеряны.").setNegativeButton("Остаться",null).setPositiveButton("Выйти",(d,w)->{if(textUi==state)list();}).show();
    }

    interface InputAction { void run(String value); }
    private void input(String title,InputAction action){ EditText edit=new EditText(this); new AlertDialog.Builder(this).setTitle(title).setView(edit).setNegativeButton("Отмена",null).setPositiveButton("ОК",(d,w)->{String value=edit.getText().toString().trim();if(!value.isEmpty())action.run(value);}).show(); }
    private EditText field(String hint, boolean secret) {
        EditText e=new EditText(this); e.setSingleLine(); e.setHint(hint);
        if(secret) e.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        body.addView(e); return e;
    }
    private void cancelScan() {
        if(scanCancellation!=null){scanCancellation.cancel();scanCancellation=null;}
    }
    private void cancelSearch(){if(searchCancellation!=null){searchCancellation.cancel();searchCancellation=null;}}
    private void searchScreen(){
        if(tree==null||current==null){toast("Сначала выберите папку");return;}
        Uri selectedTree=tree,start=current;List<Uri> baseParents=new ArrayList<>(parents);
        layout("Поиск файлов");searchScreenVisible=true;note("Поиск по части имени без учёта регистра в текущей папке и её подпапках. Провайдер может ограничивать доступ или отвечать медленно.");
        EditText query=field("Имя или часть имени",false);TextView status=text("",15);LinearLayout results=new LinearLayout(this);results.setOrientation(LinearLayout.VERTICAL);
        Button search=button("Найти",()->{}),cancel=button("Отменить поиск",()->{});cancel.setEnabled(false);body.addView(search);body.addView(cancel);body.addView(status);body.addView(results);body.addView(button("Назад к папке",this::list));
        cancel.setOnClickListener(v->{cancelSearch();search.setEnabled(true);cancel.setEnabled(false);status.setText("Поиск отменён.");});
        search.setOnClickListener(v->{
            String term=query.getText().toString().trim();if(term.isEmpty()||term.length()>256){toast("Введите от 1 до 256 символов");return;}
            cancelSearch();android.os.CancellationSignal signal=new android.os.CancellationSignal();searchCancellation=signal;results.removeAllViews();search.setEnabled(false);cancel.setEnabled(true);status.setText("Поиск…");
            new Thread(()->{try{
                FileSearch.Result found=new FileSearch(getContentResolver(),selectedTree,start,signal).search(term);
                runOnUiThread(()->{
                    if(searchCancellation!=signal||isFinishing()||isDestroyed())return;searchCancellation=null;search.setEnabled(true);cancel.setEnabled(false);
                    status.setText("Найдено: "+found.matches.size()+" · просмотрено: "+found.examined+(found.inaccessible>0?"\nНедоступных папок или элементов: "+found.inaccessible:"")+(found.limited?"\nРезультат неполный: достигнут лимит поиска.":""));
                    for(FileSearch.Match match:found.matches){Entry e=new Entry(match.uri,match.name,match.mime,match.size);
                        TextView row=text((e.dir()?"📁  ":"📄  ")+match.path,16);row.setPadding(dp(8),dp(14),dp(8),dp(14));results.addView(row);
                        row.setOnClickListener(view->{parents.clear();parents.addAll(baseParents);for(int j=0;j<match.ancestors.size()-1;j++)parents.push(match.ancestors.get(j));current=match.ancestors.get(match.ancestors.size()-1);if(e.dir()){parents.push(current);current=e.uri;list();}else open(e);});
                    }
                });
            }catch(android.os.OperationCanceledException ignored){}catch(Exception ex){runOnUiThread(()->{if(searchCancellation==signal&&!isDestroyed()){searchCancellation=null;search.setEnabled(true);cancel.setEnabled(false);status.setText("Ошибка поиска: "+ex.getMessage());}});}},"file-search").start();
        });
    }
    private void storageScreen() {
        layout("Анализ хранилища");
        try {
            android.os.StatFs fs=new android.os.StatFs(android.os.Environment.getDataDirectory().getAbsolutePath());
            long total=fs.getTotalBytes(), free=fs.getAvailableBytes(), used=Math.max(0,total-free);
            note("Внутренний раздел устройства\nВсего: "+android.text.format.Formatter.formatFileSize(this,total)+"\nДоступно приложениям: "+android.text.format.Formatter.formatFileSize(this,free)+"\nЗанято и зарезервировано: "+android.text.format.Formatter.formatFileSize(this,used));
            ProgressBar bar=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);bar.setMax(1000);bar.setProgress(total==0?0:(int)(1000.0*used/total));body.addView(bar);
            note("Системный раздел и внешние накопители в эту оценку не входят. Зарезервированное пространство включено в занятое.");
        } catch(Exception ex) { note("Не удалось определить место на внутреннем разделе: "+ex.getMessage()); }
        body.addView(button("Настройки хранилища Android",()->{try{startActivity(new Intent(android.provider.Settings.ACTION_INTERNAL_STORAGE_SETTINGS));}catch(Exception ex){error(ex);}}));
        note(tree==null?"Выберите папку на главном экране, чтобы проанализировать её содержимое.":"Анализируется последняя выбранная папка, а не всё устройство. Размеры предоставляются системой или облачным провайдером.");
        TextView report=text("",15); report.setTextIsSelectable(true);
        Button scan=button("Анализировать выбранную папку",()->{});scan.setEnabled(tree!=null); body.addView(scan);
        Button cancel=button("Отменить анализ",()->{});cancel.setEnabled(false);body.addView(cancel);body.addView(report);
        cancel.setOnClickListener(v->{cancelScan();scan.setEnabled(tree!=null);cancel.setEnabled(false);report.setText("Анализ отменён.");});
        scan.setOnClickListener(v->{
            if(tree==null)return;cancelScan();Uri selected=tree;
            android.os.CancellationSignal signal=new android.os.CancellationSignal();scanCancellation=signal;
            scan.setEnabled(false);cancel.setEnabled(true);report.setText("Анализ…");
            new Thread(()->{
                try {
                    StorageScanner.Result result=new StorageScanner(getContentResolver(),selected,signal).scan();
                    runOnUiThread(()->{
                        if(scanCancellation!=signal||isFinishing()||isDestroyed())return;
                        scanCancellation=null;scan.setEnabled(true);cancel.setEnabled(false);
                        StringBuilder summary=new StringBuilder("Файлов: ").append(result.files).append(" · папок: ").append(result.folders)
                            .append("\nУчтённый размер: ").append(android.text.format.Formatter.formatFileSize(this,result.total));
                        for(int i=0;i<StorageScanner.LABELS.length;i++)summary.append("\n").append(StorageScanner.LABELS[i]).append(": ").append(android.text.format.Formatter.formatFileSize(this,result.sizes[i]));
                        if(result.unknownSize>0)summary.append("\nБез известного размера: ").append(result.unknownSize);
                        if(result.inaccessible>0)summary.append("\nНедоступных элементов или папок: ").append(result.inaccessible);
                        if(result.limited)summary.append("\nРезультат неполный: достигнут лимит глубины или числа элементов.");
                        report.setText(summary.toString());
                    });
                } catch(android.os.OperationCanceledException ignored) {
                } catch(Exception ex) {runOnUiThread(()->{if(scanCancellation==signal&&!isDestroyed()){scanCancellation=null;scan.setEnabled(true);cancel.setEnabled(false);report.setText("Ошибка анализа: "+ex.getMessage());}});}
            },"storage-scan").start();
        });
        body.addView(button("Назад",this::home));
    }
    private void smbScreen(){
        layout("SMB3 · Windows / NAS");
        note("Укажите адрес компьютера и имя общей папки (share). Требуется учётная запись и сервер SMB3 с шифрованием; гостевой доступ, SMB1/SMB2 и DFS не поддерживаются. Используйте только доверенный сервер и сеть.");
        note("Каждая операция создаёт новое соединение; пароль не сохраняется. Для изменения сервера или учётной записи нажмите «Подключиться» снова. При повороте экрана выбор файла сбрасывается.");
        SmbUi ui=new SmbUi();smbUi=ui;
        ui.host=field("Адрес компьютера или NAS",false);ui.port=field("Порт (445)",false);ui.share=field("Имя общей папки",false);ui.domain=field("Домен (необязательно)",false);ui.user=field("Пользователь",false);ui.password=field("Пароль",true);
        ui.list=button("Подключиться и показать файлы",()->{});ui.upload=button("Загрузить в текущую папку",()->{});ui.upload.setEnabled(false);ui.status=text("",15);
        body.addView(ui.list);body.addView(ui.upload);body.addView(ui.status);ui.entries=new LinearLayout(this);ui.entries.setOrientation(LinearLayout.VERTICAL);body.addView(ui.entries);body.addView(button("Назад",this::home));
        ui.list.setOnClickListener(v->{if(ui.busy)return;SmbAccess.Credentials c=smbCredentials(ui);if(c!=null)listSmb(ui,c,"");});
        ui.upload.setOnClickListener(v->{
            if(ui.busy||ui.connection==null||ui.directory==null)return;SmbAccess.Credentials c=ui.connection;String directory=ui.directory;
            input("Имя нового файла на сервере",name->{
                if(!SmbAccess.safeName(name)){toast("Недопустимое имя файла");return;}String remote=SmbAccess.join(directory,name);
                new AlertDialog.Builder(this).setTitle("Загрузить в SMB")
                    .setMessage("Будет создан новый файл. Если он уже существует, загрузка будет отклонена. При сбое может остаться неполный файл.")
                    .setNegativeButton("Отмена",null).setPositiveButton("Выбрать файл",(d,w)->{
                        if(smbUi!=ui)return;pendingSmb=new PendingSmb(ui,c,remote,SMB_UPLOAD);Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");
                        try{startActivityForResult(i,SMB_UPLOAD);}catch(Exception ex){pendingSmb=null;error(ex);}
                    }).show();
            });
        });
    }
    private SmbAccess.Credentials smbCredentials(SmbUi ui){
        String host=ui.host.getText().toString().trim(),share=ui.share.getText().toString().trim(),domain=ui.domain.getText().toString().trim(),user=ui.user.getText().toString().trim(),password=ui.password.getText().toString();int port;
        try{String p=ui.port.getText().toString().trim();port=p.isEmpty()?445:Integer.parseInt(p);if(!FtpAccess.validCommandText(host)||host.contains("/")||host.contains("\\")||!SmbAccess.safeName(share)||!FtpAccess.validCommandText(user)||!FtpAccess.validCommandText(password)||(!domain.isEmpty()&&!FtpAccess.validCommandText(domain))||port<1||port>65535)throw new IllegalArgumentException();}
        catch(Exception ex){toast("Укажите адрес, порт, имя общей папки, пользователя и пароль");return null;}
        return new SmbAccess.Credentials(host,port,share,user,password,domain);
    }
    private void smbBusy(SmbUi ui,boolean busy){ui.busy=busy;ui.list.setEnabled(!busy);ui.upload.setEnabled(!busy&&ui.connection!=null&&ui.directory!=null);}
    private void listSmb(SmbUi ui,SmbAccess.Credentials connection,String directory){
        if(ui.busy)return;smbBusy(ui,true);ui.connection=null;ui.directory=null;ui.status.setText("Подключение и чтение папки…");ui.entries.removeAllViews();
        SmbAccess.execute(this,connection,share->SmbAccess.list(share,directory),(listing,error)->{
            if(smbUi!=ui)return;
            if(error!=null){smbBusy(ui,false);ui.status.setText("Ошибка SMB3: "+error.getMessage());return;}
            ui.connection=connection;ui.directory=directory;smbBusy(ui,false);ui.status.setText("Общая папка: "+connection.share+(directory.isEmpty()?"":" / "+directory.replace('\\','/'))+(listing.truncated?"\nПоказаны первые 1000 элементов.":""));
            if(!directory.isEmpty())ui.entries.addView(button("↑ Родительская папка",()->{int index=directory.lastIndexOf('\\');listSmb(ui,connection,index<0?"":directory.substring(0,index));}));
            if(listing.items.isEmpty()){ui.entries.addView(text("Папка пуста",15));return;}
            for(SmbAccess.Item item:listing.items){
                Button row=button((item.link?"🔗 ":item.directory?"📁 ":"📄 ")+item.name+(item.directory||item.link?"":" · "+android.text.format.Formatter.formatFileSize(this,item.size)),()->{
                    if(ui.busy)return;if(item.link){toast("Ссылки и точки повторной обработки не открываются");return;}if(!SmbAccess.safeName(item.name)){toast("Недопустимое имя файла");return;}
                    String remote=SmbAccess.join(directory,item.name);if(item.directory){listSmb(ui,connection,remote);return;}
                    pendingSmb=new PendingSmb(ui,connection,remote,SMB_DOWNLOAD);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,item.name);
                    try{startActivityForResult(i,SMB_DOWNLOAD);}catch(Exception ex){pendingSmb=null;error(ex);}
                });ui.entries.addView(row);
            }
        });
    }
    private void transferSmb(PendingSmb pending,Uri local){
        SmbUi ui=pending.ui;if(ui.busy)return;smbBusy(ui,true);ui.status.setText("Передача: "+pending.remote+"…");
        SmbAccess.execute(this,pending.connection,share->{if(pending.request==SMB_DOWNLOAD)SmbAccess.download(this,share,pending.remote,local);else SmbAccess.upload(this,share,local,pending.remote);return null;},(ignored,error)->{
            if(smbUi!=ui)return;smbBusy(ui,false);if(error==null)ui.status.setText("Передача завершена: "+pending.remote);else ui.status.setText("Ошибка передачи: "+error.getMessage()+". Файл назначения может быть неполным.");
        });
    }
    private void davClientScreen(){
        layout("WebDAV · удалённые файлы");
        note("Для HTTPS проверяется системный сертификат и имя сервера. HTTP не шифруется: используйте его только в доверенной сети. Перенаправления отключены, пароль не сохраняется.");
        DavUi ui=new DavUi();davUi=ui;ui.url=field("Адрес сервера, например https://server/dav/",false);ui.user=field("Пользователь",false);ui.password=field("Пароль",true);
        ui.anonymous=new CheckBox(this);ui.anonymous.setText("Анонимный доступ");body.addView(ui.anonymous);
        ui.status=text("",15);ui.list=button("Подключиться и показать файлы",()->{});ui.upload=button("Загрузить в текущую папку",()->{});ui.upload.setEnabled(false);
        body.addView(ui.list);body.addView(ui.upload);body.addView(ui.status);ui.entries=new LinearLayout(this);ui.entries.setOrientation(LinearLayout.VERTICAL);body.addView(ui.entries);body.addView(button("Назад",this::home));
        ui.list.setOnClickListener(v->{
            if(ui.busy)return;
            try{WebDavClient.Connection connection=WebDavClient.connection(ui.url.getText().toString().trim(),ui.user.getText().toString(),ui.password.getText().toString(),ui.anonymous.isChecked());
                davWarning(ui,connection,()->listDav(ui,connection,connection.root));
            }catch(Exception ex){toast("Адрес или учётная запись: "+ex.getMessage());}
        });
        ui.upload.setOnClickListener(v->{
            if(ui.busy||ui.connection==null||ui.directory==null)return;WebDavClient.Connection connection=ui.connection;java.net.URI directory=ui.directory;
            input("Имя файла на сервере",name->{
                java.net.URI remote;try{remote=WebDavClient.child(connection,directory,name);}catch(Exception ex){error(ex);return;}
                new AlertDialog.Builder(this).setTitle("Загрузка в WebDAV").setMessage("Файл «"+name+"» будет перезаписан, если уже существует. При ошибке сервер может сохранить неполный файл. Лимит загрузки — 256 МиБ.")
                    .setNegativeButton("Отмена",null).setPositiveButton("Выбрать файл",(d,w)->{
                        if(davUi!=ui)return;pendingDav=new PendingDav(ui,connection,remote,DAV_UPLOAD);Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");
                        try{startActivityForResult(i,DAV_UPLOAD);}catch(Exception ex){pendingDav=null;error(ex);}
                    }).show();
            });
        });
    }
    private void davWarning(DavUi ui,WebDavClient.Connection connection,Runnable action){
        if(!"http".equalsIgnoreCase(connection.root.getScheme())){if(davUi==ui)action.run();return;}
        new AlertDialog.Builder(this).setTitle("HTTP без шифрования").setMessage("Адрес, логин, пароль и файлы видны в сети. Используйте только доверенную сеть и не применяйте важные пароли.")
            .setNegativeButton("Отмена",null).setPositiveButton("Продолжить",(d,w)->{if(davUi==ui)action.run();}).show();
    }
    private void davBusy(DavUi ui,boolean busy){ui.busy=busy;ui.list.setEnabled(!busy);ui.upload.setEnabled(!busy&&ui.connection!=null&&ui.directory!=null);}
    private void listDav(DavUi ui,WebDavClient.Connection connection,java.net.URI directory){
        if(ui.busy)return;davBusy(ui,true);ui.status.setText("Чтение папки…");ui.entries.removeAllViews();ui.connection=null;ui.directory=null;
        WebDavClient.execute(this,()->WebDavClient.list(connection,directory),(listing,error)->{
            if(davUi!=ui)return;
            if(error!=null){davBusy(ui,false);ui.status.setText("Ошибка WebDAV: "+error.getMessage());return;}
            ui.connection=connection;ui.directory=directory;davBusy(ui,false);ui.status.setText("Папка: "+directory+(listing.truncated?"\nПоказаны первые 1000 элементов.":""));
            if(!directory.getPath().equals(connection.root.getPath()))ui.entries.addView(button("↑ Родительская папка",()->{java.net.URI parent=directory.resolve(directory.getPath().endsWith("/")?"../":"./");listDav(ui,connection,parent);}));
            if(listing.items.isEmpty()){ui.entries.addView(text("Папка пуста",15));return;}
            for(WebDavClient.Item item:listing.items){
                Button row=button((item.directory?"📁 ":"📄 ")+item.name+(item.directory||item.size<0?"":" · "+android.text.format.Formatter.formatFileSize(this,item.size)),()->{
                    if(ui.busy)return;if(item.directory){java.net.URI folder=item.uri;try{if(!folder.getRawPath().endsWith("/"))folder=new java.net.URI(folder.toASCIIString()+"/");}catch(Exception ex){error(ex);return;}listDav(ui,connection,folder);return;}
                    pendingDav=new PendingDav(ui,connection,item.uri,DAV_DOWNLOAD);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,item.name);
                    try{startActivityForResult(i,DAV_DOWNLOAD);}catch(Exception ex){pendingDav=null;error(ex);}
                });ui.entries.addView(row);
            }
        });
    }
    private void transferDav(PendingDav pending,Uri local){
        DavUi ui=pending.ui;if(ui.busy)return;davBusy(ui,true);ui.status.setText("Передача: "+pending.remote+"…");
        WebDavClient.execute(this,()->{if(pending.request==DAV_DOWNLOAD)WebDavClient.download(this,pending.connection,pending.remote,local);else WebDavClient.upload(this,pending.connection,pending.remote,local);return null;},(ignored,error)->{
            if(davUi!=ui)return;davBusy(ui,false);if(error==null)ui.status.setText("Передача завершена: "+pending.remote);else ui.status.setText("Ошибка передачи: "+error.getMessage()+". Файл назначения может быть неполным.");
        });
    }
    private void ftpScreen(){
        layout("FTP / FTPS · файлы");
        note("FTPS: явный TLS, системное доверие сертификату и проверка имени сервера. FTP без TLS передаёт логин, пароль и файлы открытым текстом. Используйте его только в доверенной сети.");
        note("Каждая операция создаёт отдельное подключение; пароли не сохраняются. При повороте экрана выбор файла может сброситься.");
        FtpUi ui=new FtpUi();ftpUi=ui;
        ui.host=field("Адрес сервера",false);ui.port=field("Порт (21)",false);ui.user=field("Пользователь",false);ui.password=field("Пароль",true);ui.path=field("Папка на сервере",false);ui.path.setText("/");
        ui.tls=new CheckBox(this);ui.tls.setText("Использовать FTPS (явный TLS)");ui.tls.setChecked(true);body.addView(ui.tls);
        ui.anonymous=new CheckBox(this);ui.anonymous.setText("Анонимный вход");body.addView(ui.anonymous);
        ui.status=text("",15);ui.list=button("Показать файлы",()->{});ui.upload=button("Загрузить файл на сервер",()->{});
        body.addView(ui.list);body.addView(ui.upload);body.addView(ui.status);ui.entries=new LinearLayout(this);ui.entries.setOrientation(LinearLayout.VERTICAL);body.addView(ui.entries);body.addView(button("Назад",this::home));
        ui.list.setOnClickListener(v->listFtp(ui));
        ui.upload.setOnClickListener(v->{
            if(ui.busy)return;FtpAccess.Credentials credentials=ftpCredentials(ui);String dir=ftpPath(ui);if(credentials==null||dir==null)return;
            input("Имя файла на сервере",name->{
                if(!validFtpName(name)){toast("Укажите одно имя без слэшей и управляющих символов");return;}String remote=FtpAccess.join(dir,name);
                new AlertDialog.Builder(this).setTitle("Загрузка на сервер").setMessage("Файл «"+remote+"» будет перезаписан, если уже существует. При ошибке передачи он может остаться неполным. Продолжить?")
                    .setNegativeButton("Отмена",null).setPositiveButton("Выбрать файл",(d,w)->{
                        if(ftpUi!=ui)return;pendingFtp=new PendingFtp(ui,credentials,remote,FTP_UPLOAD);
                        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
                        try{startActivityForResult(intent,FTP_UPLOAD);}catch(Exception ex){pendingFtp=null;error(ex);}
                    }).show();
            });
        });
    }
    private FtpAccess.Credentials ftpCredentials(FtpUi ui){
        String host=ui.host.getText().toString().trim();boolean anon=ui.anonymous.isChecked();String user=anon?"anonymous":ui.user.getText().toString().trim(), pass=anon?"anonymous@":ui.password.getText().toString();int port;
        try{String value=ui.port.getText().toString().trim();port=value.isEmpty()?21:Integer.parseInt(value);if(!FtpAccess.validCommandText(host)||!FtpAccess.validCommandText(user)||!FtpAccess.validCommandText(pass)||port<1||port>65535)throw new IllegalArgumentException();}
        catch(Exception ex){toast("Укажите адрес, порт, пользователя и пароль либо включите анонимный вход");return null;}
        return new FtpAccess.Credentials(host,port,user,pass,ui.tls.isChecked());
    }
    private String ftpPath(FtpUi ui){String path=ui.path.getText().toString().trim();if(!FtpAccess.validCommandText(path)||!path.startsWith("/")){toast("Укажите абсолютный путь без управляющих символов");return null;}return path;}
    private boolean validFtpName(String name){return validRemoteName(name)&&FtpAccess.validCommandText(name);}
    private void ftpWithWarning(FtpUi ui,FtpAccess.Credentials credentials,Runnable action){
        if(credentials.tls){if(ftpUi==ui)action.run();return;}
        new AlertDialog.Builder(this).setTitle("FTP без шифрования").setMessage("Логин, пароль и файлы видны в сети. Используйте только доверенную сеть и не применяйте важные пароли.")
            .setNegativeButton("Отмена",null).setPositiveButton("Продолжить",(d,w)->{if(ftpUi==ui)action.run();}).show();
    }
    private void ftpBusy(FtpUi ui,boolean busy){ui.busy=busy;ui.list.setEnabled(!busy);ui.upload.setEnabled(!busy);}
    private void listFtp(FtpUi ui){
        if(ui.busy)return;FtpAccess.Credentials credentials=ftpCredentials(ui);String path=ftpPath(ui);if(credentials==null||path==null)return;
        ftpWithWarning(ui,credentials,()->{
            if(ui.busy)return;ftpBusy(ui,true);ui.status.setText("Подключение и чтение папки…");ui.entries.removeAllViews();
            FtpAccess.execute(this,credentials,client->FtpAccess.list(client,path),(listing,exception)->{
                if(ftpUi!=ui)return;ftpBusy(ui,false);
                if(exception!=null){ui.status.setText("Ошибка FTP: "+exception.getMessage());return;}
                ui.status.setText("Папка: "+path+(listing.truncated?"\nПоказаны первые 1000 элементов.":""));
                if(!path.equals("/"))ui.entries.addView(button("↑ Родительская папка",()->{String trimmed=path.endsWith("/")?path.substring(0,path.length()-1):path;int slash=trimmed.lastIndexOf('/');ui.path.setText(slash<=0?"/":trimmed.substring(0,slash));listFtp(ui);}));
                if(listing.items.isEmpty()){ui.entries.addView(text("Папка пуста",15));return;}
                for(FtpAccess.Item item:listing.items){
                    Button row=button((item.link?"🔗 ":item.directory?"📁 ":"📄 ")+item.name+(item.directory||item.link?"":" · "+android.text.format.Formatter.formatFileSize(this,item.size)),()->{
                        if(ui.busy)return;if(item.link){toast("Символические ссылки не открываются в этой версии");return;}
                        if(!validFtpName(item.name)){toast("Недопустимое имя файла");return;}String remote=FtpAccess.join(path,item.name);
                        if(item.directory){ui.path.setText(remote);listFtp(ui);return;}
                        pendingFtp=new PendingFtp(ui,credentials,remote,FTP_DOWNLOAD);Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/octet-stream");intent.putExtra(Intent.EXTRA_TITLE,item.name);
                        try{startActivityForResult(intent,FTP_DOWNLOAD);}catch(Exception ex){pendingFtp=null;error(ex);}
                    });ui.entries.addView(row);
                }
            });
        });
    }
    private void transferFtp(PendingFtp pending,Uri local){
        FtpUi ui=pending.ui;if(ui.busy)return;ftpBusy(ui,true);ui.status.setText("Передача: "+pending.remote+"…");
        FtpAccess.execute(this,pending.credentials,client->{if(pending.request==FTP_DOWNLOAD)FtpAccess.download(this,client,pending.remote,local);else FtpAccess.upload(this,client,local,pending.remote);return null;},(ignored,exception)->{
            if(ftpUi!=ui)return;ftpBusy(ui,false);if(exception==null)ui.status.setText("Передача завершена: "+pending.remote);
            else ui.status.setText("Ошибка передачи: "+exception.getMessage()+". Файл назначения может быть неполным.");
        });
    }
    private void sftpScreen(){
        layout("SFTP · удалённые файлы");
        note("Вход по паролю или сохранённому ключу. Каждая операция создаёт отдельное SSH-соединение: проверяйте отпечаток сервера. Пароль и парольная фраза остаются в поле до выхода с экрана, но не сохраняются на диск; при повороте выбор сбросится.");
        SftpUi ui=new SftpUi();sftpUi=ui;
        ui.host=field("Адрес сервера",false); ui.port=field("Порт (22)",false); ui.user=field("Пользователь",false); ui.password=field("Пароль",true); ui.path=field("Папка на сервере",false);ui.path.setText("/");
        ui.auth=button("Вход: пароль · выбрать сохранённый ключ",()->chooseSftpKey(ui));body.addView(ui.auth);
        ui.status=text("",15); ui.list=button("Показать файлы",()->{}); ui.upload=button("Загрузить файл на сервер",()->{});
        body.addView(ui.list);body.addView(ui.upload);body.addView(ui.status);
        ui.entries=new LinearLayout(this);ui.entries.setOrientation(LinearLayout.VERTICAL);body.addView(ui.entries);
        android.text.TextWatcher clearEntries=new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){ui.entries.removeAllViews();}public void afterTextChanged(android.text.Editable text){}};
        for(EditText field:new EditText[]{ui.host,ui.port,ui.user,ui.password,ui.path})field.addTextChangedListener(clearEntries);
        body.addView(button("Назад",this::home));
        ui.list.setOnClickListener(v->listSftp(ui));
        ui.upload.setOnClickListener(v->{
            if(ui.busy)return;SftpClient.Credentials cred=sftpCredentials(ui);String dir=sftpPath(ui);if(cred==null||dir==null)return;
            input("Имя файла на сервере",name->{
                if(!validRemoteName(name)){toast("Укажите одно имя файла без слэшей");return;}
                String remote=SftpClient.join(dir,name);
                new AlertDialog.Builder(this).setTitle("Загрузка на сервер").setMessage("Файл «"+remote+"» будет перезаписан, если уже существует. При ошибке передачи он может остаться неполным. Продолжить?")
                    .setNegativeButton("Отмена",null).setPositiveButton("Выбрать файл",(d,w)->{
                        if(sftpUi!=ui)return;pendingSftp=new PendingSftp(ui,cred,remote,SFTP_UPLOAD);
                        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
                        try{startActivityForResult(intent,SFTP_UPLOAD);}catch(Exception ex){pendingSftp=null;error(ex);}
                    }).show();
            });
        });
    }
    private SftpClient.Credentials sftpCredentials(SftpUi ui){
        String host=ui.host.getText().toString().trim(), user=ui.user.getText().toString().trim(), pass=ui.password.getText().toString();int port;
        try{String value=ui.port.getText().toString().trim();port=value.isEmpty()?22:Integer.parseInt(value);if(host.isEmpty()||user.isEmpty()||(ui.keyId==null&&pass.isEmpty())||pass.length()>1024||port<1||port>65535)throw new IllegalArgumentException();}
        catch(Exception ex){toast("Укажите адрес, порт, имя и пароль или выберите ключ");return null;}
        return new SftpClient.Credentials(host,port,user,pass,ui.keyId);
    }
    private void chooseSftpKey(SftpUi ui){
        if(ui.busy)return;ui.status.setText("Чтение сохранённых ключей…");
        new Thread(()->{List<StoredSshKeys.Entry> entries=null;String problem=null;try{entries=new StoredSshKeys(getApplicationContext()).list();}catch(Exception ex){problem=ex.getMessage();}
            List<StoredSshKeys.Entry> all=entries;String failure=problem;runOnUiThread(()->{
                if(sftpUi!=ui||isDestroyed()||isFinishing()||ui.busy)return;
                if(failure!=null){ui.status.setText("Ошибка хранилища: "+failure);return;}
                List<StoredSshKeys.Entry> usable=new ArrayList<>();for(StoredSshKeys.Entry entry:all)if(entry.readable)usable.add(entry);
                String[] labels=new String[usable.size()+1];labels[0]="Вход по паролю";for(int i=0;i<usable.size();i++)labels[i+1]=usable.get(i).name+" · "+usable.get(i).id.substring(0,8);
                ui.status.setText(usable.isEmpty()?"Сохранённых ключей нет. Добавьте ключ на экране SSH-команды.":"Выберите способ входа.");
                new AlertDialog.Builder(this).setTitle("SFTP: способ входа").setItems(labels,(d,index)->{
                    if(sftpUi!=ui||ui.busy)return;ui.password.setText("");ui.entries.removeAllViews();
                    if(index==0){ui.keyId=null;ui.password.setHint("Пароль SSH");ui.auth.setText("Вход: пароль · выбрать сохранённый ключ");ui.status.setText("Выбран вход по паролю.");}
                    else{StoredSshKeys.Entry entry=usable.get(index-1);ui.keyId=entry.id;ui.password.setHint("Парольная фраза ключа (если есть)");ui.auth.setText("Ключ: "+entry.name+" · сменить");ui.status.setText("Выбран ключ: "+entry.name);}
                }).setNegativeButton("Отмена",null).show();
            });
        },"sftp-key-list").start();
    }
    private String sftpPath(SftpUi ui){String path=ui.path.getText().toString().trim();if(!path.startsWith("/")||path.indexOf('\0')>=0){toast("Укажите абсолютный путь к папке, начиная с /");return null;}return path;}
    private boolean validRemoteName(String name){return !name.isEmpty()&&!name.equals(".")&&!name.equals("..")&&!name.contains("/")&&name.indexOf('\0')<0;}
    private void sftpBusy(SftpUi ui,boolean busy){ui.busy=busy;ui.list.setEnabled(!busy);ui.upload.setEnabled(!busy);ui.auth.setEnabled(!busy);for(EditText field:new EditText[]{ui.host,ui.port,ui.user,ui.password,ui.path})field.setEnabled(!busy);}
    private void listSftp(SftpUi ui){
        if(ui.busy)return;SftpClient.Credentials credentials=sftpCredentials(ui);String path=sftpPath(ui);if(credentials==null||path==null)return;
        sftpBusy(ui,true);ui.status.setText("Подключение и чтение папки…");ui.entries.removeAllViews();
        SftpClient.execute(this,credentials,channel->SftpClient.list(channel,path),(listing,exception)->{
            if(sftpUi!=ui)return;sftpBusy(ui,false);
            if(exception!=null){ui.status.setText("Ошибка SFTP: "+exception.getMessage());return;}
            ui.status.setText("Папка: "+path+(listing.truncated?"\nПоказаны первые 1000 элементов.":""));
            if(!path.equals("/"))ui.entries.addView(button("↑ Родительская папка",()->{String trimmed=path.endsWith("/")?path.substring(0,path.length()-1):path;int slash=trimmed.lastIndexOf('/');ui.path.setText(slash<=0?"/":trimmed.substring(0,slash));listSftp(ui);}));
            if(listing.items.isEmpty()){ui.entries.addView(text("Папка пуста",15));return;}
            for(SftpClient.Item item:listing.items){
                Button row=button((item.link?"🔗 ":item.directory?"📁 ":"📄 ")+item.name+(item.directory||item.link?"":" · "+android.text.format.Formatter.formatFileSize(this,item.size)),()->{
                    if(ui.busy)return;if(item.link){toast("Символические ссылки не открываются в этой версии");return;}
                    if(!validRemoteName(item.name)){toast("Недопустимое имя файла");return;}String remote=SftpClient.join(path,item.name);
                    if(item.directory){ui.path.setText(remote);listSftp(ui);return;}
                    SftpClient.Credentials currentCred=sftpCredentials(ui);if(currentCred==null)return;pendingSftp=new PendingSftp(ui,currentCred,remote,SFTP_DOWNLOAD);
                    Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/octet-stream");intent.putExtra(Intent.EXTRA_TITLE,item.name);
                    try{startActivityForResult(intent,SFTP_DOWNLOAD);}catch(Exception ex){pendingSftp=null;error(ex);}
                });ui.entries.addView(row);
            }
        });
    }
    private void transferSftp(PendingSftp pending,Uri local){
        SftpUi ui=pending.ui;sftpBusy(ui,true);ui.status.setText("Передача: "+pending.remote+"…");
        SftpClient.execute(this,pending.credentials,channel->{if(pending.request==SFTP_DOWNLOAD)SftpClient.download(this,channel,pending.remote,local);else SftpClient.upload(this,channel,local,pending.remote);return null;},(ignored,exception)->{
            if(sftpUi!=ui)return;sftpBusy(ui,false);
            if(exception==null)ui.status.setText("Передача завершена: "+pending.remote);
            else ui.status.setText("Ошибка передачи: "+exception.getMessage()+". Файл назначения может быть неполным.");
        });
    }
    private void tunnelScreen(){
        layout("SSH · проброс порта");
        note("Локальный TCP-порт слушает только 127.0.0.1 на этом устройстве. Другое приложение на телефоне сможет к нему подключиться. Адрес назначения разрешается на стороне SSH-сервера. Это не открытие порта роутера и не VPN.");
        note("Туннель работает только пока приложение и SSH-сеанс остаются активными; Android может их остановить. При повороте экрана туннель закрывается. Пароль не сохраняется.");
        EditText host=field("SSH-сервер",false), port=field("Порт SSH (22)",false), user=field("Пользователь",false), password=field("Пароль",true);
        EditText local=field("Локальный порт (0 — автоматически)",false), remoteHost=field("Адрес назначения на стороне SSH-сервера",false), remotePort=field("Порт назначения",false);
        remoteHost.setText("127.0.0.1");local.setText("0");
        TunnelUi ui=new TunnelUi(); tunnelUi=ui; ui.status=text("",15);
        ui.start=button("Запустить туннель",()->{});ui.stop=button("Остановить",()->{});
        body.addView(ui.start);body.addView(ui.stop);body.addView(ui.status);
        body.addView(button("Обновить состояние",()->refreshTunnelUi(null)));body.addView(button("Назад",this::home));
        refreshTunnelUi(null);
        ui.start.setOnClickListener(v->{
            if(sshTunnel!=null&&(sshTunnel.isConnecting()||sshTunnel.isRunning())){toast("Остановите текущий туннель");return;}
            String h=host.getText().toString().trim(),u=user.getText().toString().trim(),p=password.getText().toString(),target=remoteHost.getText().toString().trim();
            int sshPort,localPort,targetPort;
            try{
                String ssh=port.getText().toString().trim();sshPort=ssh.isEmpty()?22:Integer.parseInt(ssh);
                localPort=Integer.parseInt(local.getText().toString().trim());targetPort=Integer.parseInt(remotePort.getText().toString().trim());
                if(h.isEmpty()||u.isEmpty()||p.isEmpty()||target.isEmpty()||sshPort<1||sshPort>65535||localPort<0||localPort>65535||targetPort<1||targetPort>65535)throw new IllegalArgumentException();
            }catch(Exception ex){toast("Заполните адреса и порты: локальный 0–65535, остальные 1–65535");return;}
            if(sshTunnel!=null)sshTunnel.stop();
            SshTunnel tunnel=new SshTunnel(target,targetPort);sshTunnel=tunnel;refreshTunnelUi(null);
            tunnel.start(this,new SftpClient.Credentials(h,sshPort,u,p),localPort,(finished,error)->{
                if(sshTunnel!=finished)return;
                if(error!=null){finished.stop();sshTunnel=null;refreshTunnelUi("Ошибка SSH-туннеля: "+error.getMessage());}
                else refreshTunnelUi(null);
            });
        });
        ui.stop.setOnClickListener(v->{if(sshTunnel!=null){SshTunnel tunnel=sshTunnel;sshTunnel=null;tunnel.stop();}refreshTunnelUi("Туннель остановлен. Если подключение ещё выполнялось, оно закроется после завершения попытки.");});
    }
    private void refreshTunnelUi(String message){
        TunnelUi ui=tunnelUi;if(ui==null)return;SshTunnel tunnel=sshTunnel;
        boolean connecting=tunnel!=null&&tunnel.isConnecting(), running=tunnel!=null&&tunnel.isRunning();
        ui.start.setEnabled(!connecting&&!running);ui.stop.setEnabled(connecting||running);
        if(message!=null)ui.status.setText(message);
        else if(connecting)ui.status.setText("Подключение… Проверьте отпечаток ключа сервера.");
        else if(running)ui.status.setText("Туннель активен: "+tunnel.description()+"\nПроверка доступности службы выполняется при подключении клиента.");
        else ui.status.setText("Туннель не активен.");
    }
    private void reverseTunnelScreen(){
        layout("SSH · обратный проброс");
        note("Порт на SSH-сервере перенаправляется к 127.0.0.1 на телефоне. Служба должна уже работать на телефоне; доступ к ней получат пользователи сервера. Это не VPN и не удалённый рабочий стол.");
        note("Запрашивается прослушивание только 127.0.0.1 сервера, но настройки SSH-сервера могут переопределить адрес и открыть порт в сеть. Проверьте GatewayPorts и брандмауэр сервера; не открывайте чувствительные службы.");
        note("Туннель закрывается при уничтожении Activity, в том числе при повороте. Android может остановить приложение; пароль не сохраняется.");
        EditText host=field("SSH-сервер",false),port=field("Порт SSH (22)",false),user=field("Пользователь",false),password=field("Пароль SSH",true);
        EditText remote=field("Порт на SSH-сервере (1–65535)",false),local=field("Порт службы на телефоне (1–65535)",false);
        TunnelUi ui=new TunnelUi();reverseTunnelUi=ui;ui.status=text("",15);ui.start=button("Запустить обратный туннель",()->{});ui.stop=button("Остановить",()->{});
        body.addView(ui.start);body.addView(ui.stop);body.addView(ui.status);body.addView(button("Обновить состояние",()->refreshReverseTunnel(null)));body.addView(button("Назад",this::home));refreshReverseTunnel(null);
        ui.start.setOnClickListener(v->{
            if(reverseTunnel!=null&&(reverseTunnel.isConnecting()||reverseTunnel.isRunning())){toast("Остановите текущий обратный туннель");return;}
            String h=host.getText().toString().trim(),u=user.getText().toString().trim(),p=password.getText().toString();int sshPort,remotePort,localPort;
            try{String ssh=port.getText().toString().trim();sshPort=ssh.isEmpty()?22:Integer.parseInt(ssh);remotePort=Integer.parseInt(remote.getText().toString().trim());localPort=Integer.parseInt(local.getText().toString().trim());
                if(h.isEmpty()||u.isEmpty()||p.isEmpty()||sshPort<1||sshPort>65535||remotePort<1||remotePort>65535||localPort<1||localPort>65535)throw new IllegalArgumentException();
            }catch(Exception ex){toast("Укажите адрес, пользователя, пароль и порты от 1 до 65535");return;}
            new AlertDialog.Builder(this).setTitle("Открыть обратный туннель?").setMessage("Пользователи SSH-сервера смогут подключиться к службе телефона. Сервер может открыть порт и другим сетевым клиентам. Продолжайте только после проверки настроек сервера.")
                .setNegativeButton("Отмена",null).setPositiveButton("Подключиться",(d,w)->{
                    if(reverseTunnel!=null&&(reverseTunnel.isConnecting()||reverseTunnel.isRunning()))return;
                    if(reverseTunnel!=null)reverseTunnel.stop();ReverseSshTunnel tunnel=new ReverseSshTunnel(remotePort,localPort);reverseTunnel=tunnel;refreshReverseTunnel(null);
                    tunnel.start(this,new SftpClient.Credentials(h,sshPort,u,p),(finished,error)->{
                        if(reverseTunnel!=finished)return;
                        if(error!=null){finished.stop();reverseTunnel=null;refreshReverseTunnel("Ошибка обратного туннеля: "+error.getMessage());}else refreshReverseTunnel(null);
                    });
                }).show();
        });
        ui.stop.setOnClickListener(v->{ReverseSshTunnel tunnel=reverseTunnel;reverseTunnel=null;if(tunnel!=null)tunnel.stop();refreshReverseTunnel("Туннель остановлен. Незавершённое подключение закроется после завершения попытки.");});
    }
    private void refreshReverseTunnel(String message){
        TunnelUi ui=reverseTunnelUi;if(ui==null)return;ReverseSshTunnel tunnel=reverseTunnel;boolean connecting=tunnel!=null&&tunnel.isConnecting(),running=tunnel!=null&&tunnel.isRunning();
        ui.start.setEnabled(!connecting&&!running);ui.stop.setEnabled(connecting||running);
        if(message!=null)ui.status.setText(message);else if(connecting)ui.status.setText("Подключение… Проверьте отпечаток ключа сервера.");
        else if(running)ui.status.setText("Сервер принял запрос: "+tunnel.description()+"\nФактический адрес прослушивания зависит от настроек сервера. Доступность службы пока не проверена.");else ui.status.setText("Туннель не активен.");
    }
    private void stopInteractiveSsh(){InteractiveSsh shell=interactiveSsh;interactiveSsh=null;if(shell!=null)shell.stop();}
    private void interactiveSshScreen(){
        layout("SSH · оболочка");
        note("Простой построчный ввод, не полноценный терминал: управляющие последовательности, цвет, vim и top могут работать неправильно. Сеанс закрывается при выходе с экрана или повороте. Пароль входа не сохраняется.");
        note("Вывод ограничен последними 32 КиБ символов. Скрытие ввода прячет текст только на телефоне: сервер или команда могут отобразить введённые данные в выводе.");
        EditText host=field("SSH-сервер",false),port=field("Порт (22)",false),user=field("Пользователь",false),password=field("Пароль SSH",true);
        TextView status=text("Не подключено",15);body.addView(status);
        ScrollView outputScroll=new ScrollView(this);TextView output=text("",14);output.setTypeface(android.graphics.Typeface.MONOSPACE);output.setTextIsSelectable(true);outputScroll.addView(output);body.addView(outputScroll,new LinearLayout.LayoutParams(-1,dp(240)));
        EditText input=field("Команда или ответ программе",false);input.setEnabled(false);
        CheckBox hidden=new CheckBox(this);hidden.setText("Скрыть ввод на экране");body.addView(hidden);
        hidden.setOnCheckedChangeListener((b,checked)->{input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|(checked?android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD:android.text.InputType.TYPE_TEXT_VARIATION_NORMAL));input.setSingleLine(true);input.setSelection(input.length());});
        Button connect=button("Подключиться",()->{}),disconnect=button("Отключиться",()->{}),send=button("Отправить строку",()->{}),interrupt=button("Ctrl+C",()->{});
        disconnect.setEnabled(false);send.setEnabled(false);interrupt.setEnabled(false);
        body.addView(connect);body.addView(disconnect);body.addView(send);body.addView(interrupt);body.addView(button("Назад",this::home));
        connect.setOnClickListener(v->{
            if(interactiveSsh!=null)return;String h=host.getText().toString().trim(),u=user.getText().toString().trim(),p=password.getText().toString();int sshPort;
            try{String value=port.getText().toString().trim();sshPort=value.isEmpty()?22:Integer.parseInt(value);if(h.isEmpty()||u.isEmpty()||p.isEmpty()||sshPort<1||sshPort>65535)throw new IllegalArgumentException();}
            catch(Exception ex){toast("Укажите адрес, порт, имя и пароль");return;}
            connect.setEnabled(false);disconnect.setEnabled(true);status.setText("Подключение… Сравните отпечаток ключа сервера.");output.setText("");
            InteractiveSsh[] reference=new InteractiveSsh[1];
            InteractiveSsh shell=new InteractiveSsh(this,new InteractiveSsh.Listener(){
                public void connected(){if(interactiveSsh!=reference[0])return;status.setText("Подключено · ввод построчный");input.setEnabled(true);send.setEnabled(true);interrupt.setEnabled(true);}
                public void output(String chunk){if(interactiveSsh!=reference[0])return;String combined=output.getText().toString()+chunk;if(combined.length()>32768)combined=combined.substring(combined.length()-32768);output.setText(combined);outputScroll.post(()->outputScroll.fullScroll(View.FOCUS_DOWN));}
                public void finished(String reason){if(interactiveSsh!=reference[0])return;interactiveSsh=null;status.setText(reason);connect.setEnabled(true);disconnect.setEnabled(false);input.setEnabled(false);send.setEnabled(false);interrupt.setEnabled(false);}
            });
            reference[0]=shell;interactiveSsh=shell;shell.start(new SftpClient.Credentials(h,sshPort,u,p));
        });
        shellUiReset=()->{status.setText("Отключено. Незавершённая попытка подключения будет закрыта после её завершения.");connect.setEnabled(true);disconnect.setEnabled(false);input.setText("");input.setEnabled(false);send.setEnabled(false);interrupt.setEnabled(false);};
        disconnect.setOnClickListener(v->{stopInteractiveSsh();shellUiReset.run();});
        send.setOnClickListener(v->{InteractiveSsh shell=interactiveSsh;if(shell==null)return;String line=input.getText().toString();if(line.length()>4096){toast("Строка не должна превышать 4096 символов");return;}if(shell.send((line+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8)))input.setText("");else toast("Нет соединения или очередь отправки заполнена");});
        interrupt.setOnClickListener(v->{InteractiveSsh shell=interactiveSsh;if(shell==null||!shell.send(new byte[]{3}))toast("Нет соединения или очередь отправки заполнена");});
    }
    private void sshScreen() {
        layout("SSH · команда");
        note("Парольная авторизация, одна команда за соединение. Перед входом проверьте отпечаток ключа сервера.");
        EditText host=field("Адрес сервера",false), port=field("Порт (по умолчанию 22)",false), user=field("Пользователь",false), password=field("Пароль",true), command=field("Команда",false);
        TextView output=text("",14); Button run=button("Выполнить",()->{}); body.addView(run); body.addView(output);
        run.setOnClickListener(v->{
            String h=host.getText().toString().trim(), u=user.getText().toString().trim(), p=password.getText().toString(), cmd=command.getText().toString();
            int number; try { number=port.getText().toString().trim().isEmpty()?22:Integer.parseInt(port.getText().toString().trim()); if(number<1||number>65535||h.isEmpty()||u.isEmpty()||p.isEmpty()||cmd.trim().isEmpty()) throw new IllegalArgumentException(); }
            catch(Exception ex){toast("Заполните поля и укажите корректный порт");return;}
            run.setEnabled(false); output.setText("Подключение…");
            SshRunner.run(this,h,number,u,p,cmd,answer->{output.setText(answer);run.setEnabled(true);});
        });
        body.addView(button("Назад",this::home));
    }
    private void stopVnc(){VncClient client=vncClient;vncClient=null;if(client!=null)client.stop();}
    private void vncScreen(){
        layout("Удалённый рабочий стол · VNC");
        note("Подключение к уже запущенному VNC-серверу (RFB 3.3, 3.7 или 3.8). Нужны разрешение владельца и настройки сервера. Поддерживаются обычный пароль VNC или явно разрешённый вход без пароля, только raw-картинка и базовое управление мышью.");
        note("VNC не шифрует изображение, ввод и пароль; проверка подлинности сервера отсутствует. Используйте доверенную сеть или проверенный SSH-туннель к серверу, не выставляйте VNC в интернет. Для Android нужен отдельный сервер с разрешением на трансляцию и управление.");
        EditText host=field("Адрес VNC (для SSH-туннеля 127.0.0.1)",false),port=field("Порт VNC (5900)",false),password=field("Пароль VNC: 1–8 ASCII-символов",true);host.setText("127.0.0.1");
        CheckBox noPassword=new CheckBox(this);noPassword.setText("Разрешить вход без пароля, если сервер его предлагает");body.addView(noPassword);
        TextView status=text("Не подключено",15);body.addView(status);VncView display=new VncView(this);body.addView(display,new LinearLayout.LayoutParams(-1,dp(300)));
        LinearLayout zoom=new LinearLayout(this);body.addView(zoom);Button zoomOut=button("−",()->display.setZoom(display.zoom/1.5f)),zoomIn=button("+",()->display.setZoom(display.zoom*1.5f)),resetZoom=button("Сброс",display::resetZoom),pan=button("Режим: управление",()->{});zoom.addView(zoomOut);zoom.addView(zoomIn);zoom.addView(resetZoom);body.addView(pan);
        pan.setOnClickListener(v->{display.setPanMode(!display.panMode);pan.setText(display.panMode?"Режим: перемещение экрана":"Режим: управление");});
        note("При увеличении включите режим перемещения, чтобы перетаскивать картинку без кликов; затем вернитесь в режим управления.");
        EditText input=field("Текст для отправки (до 256 символов)",false);
        EditText clipInput=new EditText(this);clipInput.setHint("Текст в буфер удалённой системы (Latin-1)");clipInput.setMinLines(2);clipInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);clipInput.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(65536)});body.addView(clipInput);
        final String[] remoteClipboard={null};Button sendClipboard=button("Отправить текст в буфер сервера",()->{}),copyClipboard=button("Показать буфер сервера",()->{});sendClipboard.setEnabled(false);copyClipboard.setEnabled(false);body.addView(sendClipboard);body.addView(copyClipboard);
        Button connect=button("Подключиться",()->{}),disconnect=button("Отключиться",()->{}),send=button("Отправить текст",()->{});disconnect.setEnabled(false);send.setEnabled(false);
        body.addView(connect);body.addView(disconnect);body.addView(send);
        LinearLayout keys=new LinearLayout(this);body.addView(keys);Button enter=button("Enter",()->{}),backspace=button("⌫",()->{}),escape=button("Esc",()->{}),tab=button("Tab",()->{});keys.addView(enter);keys.addView(backspace);keys.addView(escape);keys.addView(tab);
        enter.setEnabled(false);backspace.setEnabled(false);escape.setEnabled(false);tab.setEnabled(false);
        LinearLayout navigation=new LinearLayout(this);body.addView(navigation);Button left=button("←",()->{}),up=button("↑",()->{}),down=button("↓",()->{}),rightArrow=button("→",()->{}),delete=button("Del",()->{});for(Button key:new Button[]{left,up,down,rightArrow,delete}){key.setMinWidth(0);key.setMinimumWidth(0);navigation.addView(key,new LinearLayout.LayoutParams(0,-2,1));}
        left.setEnabled(false);up.setEnabled(false);down.setEnabled(false);rightArrow.setEnabled(false);delete.setEnabled(false);
        note("Правая кнопка и прокрутка действуют в последней выбранной точке экрана; если точка не выбиралась — по центру.");
        LinearLayout mouse=new LinearLayout(this);body.addView(mouse);Button right=button("Правый клик",()->{}),wheelUp=button("↑",()->{}),wheelDown=button("↓",()->{});mouse.addView(right);mouse.addView(wheelUp);mouse.addView(wheelDown);right.setEnabled(false);wheelUp.setEnabled(false);wheelDown.setEnabled(false);body.addView(button("Назад",this::home));
        Runnable disconnected=()->{connect.setEnabled(true);disconnect.setEnabled(false);send.setEnabled(false);enter.setEnabled(false);backspace.setEnabled(false);escape.setEnabled(false);tab.setEnabled(false);left.setEnabled(false);up.setEnabled(false);down.setEnabled(false);rightArrow.setEnabled(false);delete.setEnabled(false);right.setEnabled(false);wheelUp.setEnabled(false);wheelDown.setEnabled(false);sendClipboard.setEnabled(false);copyClipboard.setEnabled(false);remoteClipboard[0]=null;display.clear();pan.setText("Режим: управление");};
        vncUiReset=()->{disconnected.run();status.setText("Соединение закрыто при переходе приложения в фон.");};
        connect.setOnClickListener(v->{
            if(vncClient!=null)return;String h=host.getText().toString().trim(),secret=password.getText().toString();boolean anonymous=noPassword.isChecked();int number;
            try{String value=port.getText().toString().trim();number=value.isEmpty()?5900:Integer.parseInt(value);if(h.isEmpty()||h.length()>253||number<1||number>65535||(!secret.isEmpty()&&!VncClient.validPassword(secret))||(secret.isEmpty()&&!anonymous))throw new IllegalArgumentException();}
            catch(Exception ex){toast("Укажите адрес и порт; пароль VNC — 1–8 ASCII-символов, либо явно разрешите вход без пароля");return;}
            new AlertDialog.Builder(this).setTitle("Подключиться по VNC?").setMessage("Соединение не шифруется и сервер не проверяется. Используйте доверенный сервер и сеть либо предварительно настроенный SSH-туннель. Управление затрагивает удалённый компьютер.")
                .setNegativeButton("Отмена",null).setPositiveButton("Подключиться",(d,w)->{
                    if(vncClient!=null)return;connect.setEnabled(false);disconnect.setEnabled(true);status.setText("Подключение…");password.setText("");
                    Object frameLock=new Object();final int[][] pending={null};final int[] dimensions={0,0};final boolean[] scheduled={false};VncClient[] reference=new VncClient[1];
                    VncClient client=new VncClient(new VncClient.Listener(){
                        public void connected(int width,int height,String name){runOnUiThread(()->{if(vncClient!=reference[0]||isDestroyed())return;status.setText("Подключено: "+name+" · "+width+" × "+height+". Нажатие — левая кнопка мыши.");send.setEnabled(true);enter.setEnabled(true);backspace.setEnabled(true);escape.setEnabled(true);tab.setEnabled(true);left.setEnabled(true);up.setEnabled(true);down.setEnabled(true);rightArrow.setEnabled(true);delete.setEnabled(true);right.setEnabled(true);wheelUp.setEnabled(true);wheelDown.setEnabled(true);sendClipboard.setEnabled(true);});}
                        public void frame(int width,int height,int[] pixels){synchronized(frameLock){pending[0]=pixels;dimensions[0]=width;dimensions[1]=height;if(scheduled[0])return;scheduled[0]=true;}
                            runOnUiThread(()->{int[] frame;int fw,fh;synchronized(frameLock){frame=pending[0];pending[0]=null;fw=dimensions[0];fh=dimensions[1];scheduled[0]=false;}if(vncClient==reference[0]&&!isDestroyed()&&frame!=null)display.updateFrame(fw,fh,frame);});}
                        public void clipboard(String text){runOnUiThread(()->{if(vncClient!=reference[0]||isDestroyed())return;remoteClipboard[0]=text;copyClipboard.setEnabled(true);});}
                        public void finished(String reason){runOnUiThread(()->{if(vncClient!=reference[0]||isDestroyed())return;vncClient=null;disconnected.run();status.setText(reason);});}
                    });reference[0]=client;vncClient=client;display.client=client;client.start(h,number,secret,anonymous);
                }).show();
        });
        disconnect.setOnClickListener(v->{stopVnc();disconnected.run();status.setText("Отключено");});
        sendClipboard.setOnClickListener(v->{String value=clipInput.getText().toString();VncClient client=vncClient;if(client==null)return;if(VncClient.clipboardBytes(value)==null){toast("Буфер VNC: только Latin-1, до 65536 байт");return;}
            new AlertDialog.Builder(this).setTitle("Отправить буфер на сервер?").setMessage("Текст будет передан удалённой системе без шифрования VNC. Не отправляйте конфиденциальные данные по незащищённой сети.").setNegativeButton("Отмена",null).setPositiveButton("Отправить",(d,w)->{if(vncClient==client){if(client.sendClipboard(value))toast("Текст отправляется в буфер сервера");else toast("Не удалось отправить буфер");}}).show();
        });
        copyClipboard.setOnClickListener(v->{String value=remoteClipboard[0];if(value==null)return;String preview=value.length()>2048?value.substring(0,2048)+"\n… (показаны первые 2048 символов)":value;
            new AlertDialog.Builder(this).setTitle("Буфер VNC-сервера").setMessage(preview+"\n\nДанные поступили от удалённого сервера. Копирование заменит системный буфер телефона.").setNegativeButton("Закрыть",null).setPositiveButton("Скопировать",(d,w)->{if(remoteClipboard[0]==value){android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);clipboard.setPrimaryClip(ClipData.newPlainText("VNC",value));toast("Текст скопирован");}}).show();
        });
        send.setOnClickListener(v->{VncClient client=vncClient;String text=input.getText().toString();if(client!=null&&client.keys(text))input.setText("");else toast("Текст до 256 символов без управляющих знаков или соединение недоступно");});
        left.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff51);});up.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff52);});rightArrow.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff53);});down.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff54);});delete.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xffff);});
        right.setOnClickListener(v->{if(vncClient!=null&&display.frame!=null&&!display.down&&!display.panMode)vncClient.click(display.lastX,display.lastY,4);});
        wheelUp.setOnClickListener(v->{if(vncClient!=null&&display.frame!=null&&!display.down&&!display.panMode)vncClient.click(display.lastX,display.lastY,8);});wheelDown.setOnClickListener(v->{if(vncClient!=null&&display.frame!=null&&!display.down&&!display.panMode)vncClient.click(display.lastX,display.lastY,16);});
        enter.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff0d);});backspace.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff08);});escape.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff1b);});tab.setOnClickListener(v->{if(vncClient!=null)vncClient.special(0xff09);});
    }
    static class VncView extends View {
        VncClient client;Bitmap frame;int frameWidth,frameHeight,lastX,lastY;boolean down,panMode,panning;long lastMove;float zoom=1,panX,panY,touchX,touchY;
        VncView(Context context){super(context);setBackgroundColor(Color.DKGRAY);}
        void updateFrame(int width,int height,int[] pixels){try{if(frame==null||frameWidth!=width||frameHeight!=height){if(frame!=null)frame.recycle();frame=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);frameWidth=width;frameHeight=height;lastX=width/2;lastY=height/2;clampPan();}frame.setPixels(pixels,0,width,0,0,width,height);invalidate();}catch(OutOfMemoryError e){VncClient old=client;clear();if(old!=null)old.stop();}}
        void clear(){client=null;down=false;panning=false;panMode=false;zoom=1;panX=panY=0;if(frame!=null){frame.recycle();frame=null;}frameWidth=frameHeight=0;invalidate();}
        void setZoom(float value){if(down||panning||Float.isNaN(value)||Float.isInfinite(value))return;zoom=Math.max(1,Math.min(4,value));clampPan();invalidate();}
        void resetZoom(){if(down||panning)return;zoom=1;panX=panY=0;invalidate();}
        void setPanMode(boolean value){if(down&&client!=null){client.pointer(lastX,lastY,false);down=false;}if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);panning=false;panMode=value;}
        private float scale(){return frame==null||getWidth()<=0||getHeight()<=0?0:Math.min((float)getWidth()/frameWidth,(float)getHeight()/frameHeight)*zoom;}
        private void clampPan(){if(frame==null)return;float scale=scale(),x=Math.max(0,(frameWidth*scale-getWidth())/2),y=Math.max(0,(frameHeight*scale-getHeight())/2);panX=Math.max(-x,Math.min(x,panX));panY=Math.max(-y,Math.min(y,panY));}
        @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);clampPan();}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);if(frame==null)return;float scale=scale(),w=frameWidth*scale,h=frameHeight*scale;canvas.drawBitmap(frame,null,new RectF((getWidth()-w)/2+panX,(getHeight()-h)/2+panY,(getWidth()+w)/2+panX,(getHeight()+h)/2+panY),null);}
        @Override public boolean onTouchEvent(MotionEvent event){
            if(client==null||frame==null||scale()<=0)return false;int action=event.getActionMasked();
            if(panMode){if(action==MotionEvent.ACTION_DOWN){panning=true;touchX=event.getX();touchY=event.getY();if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(true);return true;}
                if(!panning)return false;if(action==MotionEvent.ACTION_MOVE){panX+=event.getX()-touchX;panY+=event.getY()-touchY;touchX=event.getX();touchY=event.getY();clampPan();invalidate();return true;}
                if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){panning=false;if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);return true;}return true;}
            float scale=scale(),left=(getWidth()-frameWidth*scale)/2+panX,top=(getHeight()-frameHeight*scale)/2+panY,xx=(event.getX()-left)/scale,yy=(event.getY()-top)/scale;
            if(action==MotionEvent.ACTION_DOWN){if(xx<0||yy<0||xx>=frameWidth||yy>=frameHeight)return false;down=true;if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(true);}
            if(!down)return false;lastX=Math.max(0,Math.min(frameWidth-1,(int)xx));lastY=Math.max(0,Math.min(frameHeight-1,(int)yy));
            if(action==MotionEvent.ACTION_MOVE){long now=android.os.SystemClock.uptimeMillis();if(now-lastMove>=50){client.pointer(lastX,lastY,true);lastMove=now;}return true;}
            if(action==MotionEvent.ACTION_DOWN){client.pointer(lastX,lastY,true);return true;}
            if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){client.pointer(lastX,lastY,false);down=false;if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);if(action==MotionEvent.ACTION_UP)performClick();return true;}return true;
        }
        @Override public boolean performClick(){super.performClick();return true;}
    }
    private void cancelKeySsh(){if(keySshCancel!=null){keySshCancel.cancel();keySshCancel=null;}}
    private void sshKeyScreen(){
        layout("SSH · команда с ключом");note("Выберите закрытый ключ из файла или сохранённых. Добавленные ключи зашифрованы Android Keystore в данных приложения, без биометрической проверки; парольная фраза не сохраняется. Используйте доверенный провайдер. Размер ключа — до 64 КиБ.");
        note("Одна команда за соединение, без интерактивного ввода. Сверьте отпечаток ключа сервера по независимому каналу. При выходе с экрана подключение отменяется; уже запущенная команда на сервере может продолжиться.");
        KeySshUi ui=new KeySshUi();keySshUi=ui;ui.status=text("Ключ не выбран",15);
        EditText host=field("Адрес сервера",false),port=field("Порт SSH (22)",false),user=field("Пользователь",false),passphrase=field("Парольная фраза ключа (если есть)",true),command=field("Команда",false);
        body.addView(button("Выбрать закрытый ключ",()->{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);try{startActivityForResult(intent,SSH_KEY_OPEN);}catch(Exception ex){error(ex);}}));
        body.addView(button("Сохранить выбранный файл ключа",()->saveSelectedSshKey(ui)));
        body.addView(button("Сохранённые ключи: выбрать или удалить",()->browseSshKeys(ui)));
        Button run=button("Выполнить команду",()->{}),cancel=button("Отменить",()->{});cancel.setEnabled(false);body.addView(run);body.addView(cancel);body.addView(ui.status);body.addView(button("Назад",this::home));
        run.setOnClickListener(v->{
            String h=host.getText().toString().trim(),u=user.getText().toString().trim(),cmd=command.getText().toString();int sshPort;
            try{String value=port.getText().toString().trim();sshPort=value.isEmpty()?22:Integer.parseInt(value);if((ui.key==null&&ui.savedId==null)||h.isEmpty()||u.isEmpty()||cmd.trim().isEmpty()||sshPort<1||sshPort>65535||passphrase.length()>1024)throw new IllegalArgumentException();}
            catch(Exception ex){toast("Выберите ключ и заполните адрес, пользователя, порт и команду");return;}
            char[] chars=new char[passphrase.length()];passphrase.getText().getChars(0,passphrase.length(),chars,0);passphrase.setText("");byte[] secret;
            try{java.nio.ByteBuffer bytes=java.nio.charset.StandardCharsets.UTF_8.newEncoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(chars));secret=new byte[bytes.remaining()];bytes.get(secret);if(bytes.hasArray())java.util.Arrays.fill(bytes.array(),(byte)0);}
            catch(Exception ex){toast("Не удалось прочитать парольную фразу");return;}finally{java.util.Arrays.fill(chars,'\0');}
            android.os.CancellationSignal signal=new android.os.CancellationSignal();keySshCancel=signal;run.setEnabled(false);cancel.setEnabled(true);ui.status.setText("Подключение… Проверьте отпечаток сервера.");
            SshRunner.runWithKey(this,ui.key,ui.savedId,h,sshPort,u,secret,cmd,signal,answer->{if(keySshUi!=ui||keySshCancel!=signal)return;keySshCancel=null;run.setEnabled(true);cancel.setEnabled(false);ui.status.setText(answer);});
        });
        cancel.setOnClickListener(v->{cancelKeySsh();run.setEnabled(true);cancel.setEnabled(false);ui.status.setText("Отменено. Удалённая команда может продолжить работу.");});
    }
    private void saveSelectedSshKey(KeySshUi ui){
        if(ui.saving){toast("Сохранение уже выполняется");return;}if(ui.key==null){toast("Сначала выберите файл ключа");return;}Uri source=ui.key;
        input("Название ключа (до 80 символов)",name->{
            if(keySshUi!=ui||ui.saving)return;ui.saving=true;ui.status.setText("Импорт ключа…");
            new Thread(()->{byte[] key=null;String problem=null;com.jcraft.jsch.JSch jsch=new com.jcraft.jsch.JSch();
                try{try(InputStream in=getContentResolver().openInputStream(source)){if(in==null)throw new IOException("Файл ключа недоступен");key=SshRunner.readKey(in,new android.os.CancellationSignal());}
                    jsch.addIdentity("import",key,null,null);new StoredSshKeys(getApplicationContext()).add(name,key);
                }catch(Exception ex){problem=ex.getMessage();}finally{try{jsch.removeAllIdentity();}catch(Exception ignored){}if(key!=null)java.util.Arrays.fill(key,(byte)0);}
                String failure=problem;runOnUiThread(()->{if(keySshUi!=ui||isDestroyed()||isFinishing())return;ui.saving=false;ui.status.setText(failure==null?"Ключ сохранён: "+name:"Ошибка сохранения ключа: "+failure);});
            },"ssh-key-import").start();
        });
    }
    private void browseSshKeys(KeySshUi ui){
        ui.status.setText("Чтение сохранённых ключей…");
        new Thread(()->{List<StoredSshKeys.Entry> entries=null;String problem=null;try{entries=new StoredSshKeys(getApplicationContext()).list();}catch(Exception ex){problem=ex.getMessage();}
            List<StoredSshKeys.Entry> items=entries;String failure=problem;runOnUiThread(()->{
                if(keySshUi!=ui||isFinishing()||isDestroyed())return;if(failure!=null){ui.status.setText("Ошибка хранилища: "+failure);return;}ui.status.setText("Сохранённых ключей: "+items.size());
                if(items.isEmpty()){toast("Сохранённых ключей нет");return;}
                String[] labels=new String[items.size()];for(int i=0;i<labels.length;i++)labels[i]=items.get(i).name+" · "+items.get(i).id.substring(0,8);
                new AlertDialog.Builder(this).setTitle("Сохранённые ключи").setItems(labels,(dialog,index)->{
                    StoredSshKeys.Entry entry=items.get(index);
                    new AlertDialog.Builder(this).setTitle(labels[index]).setItems(entry.readable?new String[]{"Выбрать для команды","Удалить"}:new String[]{"Удалить повреждённую запись"},(d,choice)->{
                        if(entry.readable&&choice==0){ui.key=null;ui.savedId=entry.id;ui.status.setText("Выбран сохранённый ключ: "+entry.name);return;}
                        new AlertDialog.Builder(this).setTitle("Удалить сохранённый ключ?").setMessage("Удаляется копия из приложения; исходный файл не меняется. Восстановить эту копию будет нельзя.").setNegativeButton("Отмена",null).setPositiveButton("Удалить",(d2,w)->{
                            new Thread(()->{String issue=null;try{new StoredSshKeys(getApplicationContext()).delete(entry.id);}catch(Exception ex){issue=ex.getMessage();}String err=issue;runOnUiThread(()->{if(keySshUi!=ui||isDestroyed())return;if(err==null&&entry.id.equals(ui.savedId))ui.savedId=null;ui.status.setText(err==null?"Сохранённый ключ удалён":"Ошибка удаления: "+err);});},"ssh-key-delete").start();
                        }).show();
                    }).setNegativeButton("Отмена",null).show();
                }).setNegativeButton("Отмена",null).show();
            });
        },"ssh-key-list").start();
    }
    private void accountsScreen(){
        layout("Локальные учётные записи");Object token=new Object();accountsView=token;
        note("Учётные записи используются только для входа в HTTP/WebDAV-сервер этого приложения. Запись разрешается отдельно для каждого пользователя и включается на сервере. Пароли хранятся в виде солёных хешей, но передаются по HTTP без шифрования.");
        note("После удаления данных приложения учётные записи исчезнут. Удаление пользователя запрещает новые запросы, но уже начатая операция может завершиться.");
        EditText user=field("Имя: латинские буквы, цифры, . _ -",false),password=field("Пароль: от 8 до 256 символов",true);
        CheckBox accountWrite=new CheckBox(this);accountWrite.setText("Разрешить этому пользователю запись и удаление через WebDAV");body.addView(accountWrite);
        TextView status=text("",15);Button add=button("Создать учётную запись",()->{});body.addView(add);body.addView(status);
        LinearLayout accounts=new LinearLayout(this);accounts.setOrientation(LinearLayout.VERTICAL);body.addView(accounts);
        body.addView(button("Назад к серверу",this::webScreen));
        try{
            List<String> users=new LocalAccounts(this).list();if(users.isEmpty())accounts.addView(text("Пока нет учётных записей",15));
            LocalAccounts store=new LocalAccounts(this);
            for(String name:users){boolean writable=store.canWrite(name);
                accounts.addView(button(name+(writable?" · чтение и запись":" · только чтение"),()->new AlertDialog.Builder(this).setTitle("Права: "+name)
                    .setMessage(writable?"Запретить запись этому пользователю? Уже начатые операции могут завершиться.":"Разрешить пользователю изменять и удалять файлы, когда запись включена на сервере?")
                    .setNegativeButton("Отмена",null).setPositiveButton(writable?"Запретить запись":"Разрешить запись",(d,w)->{try{new LocalAccounts(this).setCanWrite(name,!writable);accountsScreen();}catch(Exception ex){error(ex);}}).show()));
                accounts.addView(button("Сменить пароль: "+name,()->changeAccountPassword(name,token,status)));
                accounts.addView(button("Удалить пользователя: "+name,()->new AlertDialog.Builder(this).setTitle("Удалить учётную запись?")
                .setMessage("Новые запросы пользователя «"+name+"» будут отклоняться; уже начатые операции могут завершиться.")
                .setNegativeButton("Отмена",null).setPositiveButton("Удалить",(d,w)->{try{new LocalAccounts(this).remove(name);accountsScreen();}catch(Exception ex){error(ex);}}).show()));}
        }catch(Exception ex){status.setText("Не удалось прочитать учётные записи: "+ex.getMessage());}
        add.setOnClickListener(v->{
            String name=user.getText().toString().trim();char[] secret=new char[password.length()];password.getText().getChars(0,password.length(),secret,0);
            try{if(!LocalAccounts.validUsername(name))throw new IOException("Имя: только латинские буквы, цифры и . _ -");LocalAccounts.validatePassword(secret);}
            catch(Exception ex){java.util.Arrays.fill(secret,'\0');error(ex);return;}
            boolean canWrite=accountWrite.isChecked();password.setText("");add.setEnabled(false);status.setText("Создание…");
            new Thread(()->{String problem=null;try{new LocalAccounts(getApplicationContext()).add(name,secret,canWrite);}catch(Exception ex){problem=ex.getMessage();}finally{java.util.Arrays.fill(secret,'\0');}
                String failure=problem;runOnUiThread(()->{if(accountsView!=token||isFinishing()||isDestroyed())return;if(failure!=null){status.setText("Ошибка: "+failure);add.setEnabled(true);}else{toast("Учётная запись создана");accountsScreen();}});
            },"account-create").start();
        });
    }
    private void changeAccountPassword(String name,Object token,TextView status){
        LinearLayout fields=new LinearLayout(this);fields.setOrientation(LinearLayout.VERTICAL);fields.setPadding(dp(20),0,dp(20),0);
        EditText password=new EditText(this),confirmation=new EditText(this);
        password.setSingleLine();confirmation.setSingleLine();password.setHint("Новый пароль (8–256 символов)");confirmation.setHint("Повторите пароль");
        int inputType=android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD;
        password.setInputType(inputType);confirmation.setInputType(inputType);fields.addView(password);fields.addView(confirmation);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Новый пароль: "+name)
            .setMessage("Старый пароль перестанет действовать для новых запросов; уже начатые операции могут завершиться.")
            .setView(fields).setNegativeButton("Отмена",null).setPositiveButton("Сохранить",null).create();
        dialog.setOnDismissListener(d->{password.setText("");confirmation.setText("");});
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            char[] secret=new char[password.length()],repeat=new char[confirmation.length()];
            password.getText().getChars(0,password.length(),secret,0);confirmation.getText().getChars(0,confirmation.length(),repeat,0);
            try{LocalAccounts.validatePassword(secret);if(!java.util.Arrays.equals(secret,repeat))throw new IOException("Пароли не совпадают");}
            catch(Exception ex){java.util.Arrays.fill(secret,'\0');java.util.Arrays.fill(repeat,'\0');toast(ex.getMessage());return;}
            java.util.Arrays.fill(repeat,'\0');dialog.dismiss();status.setText("Смена пароля…");
            new Thread(()->{String problem=null;try{new LocalAccounts(getApplicationContext()).changePassword(name,secret);}catch(Exception ex){problem=ex.getMessage();}finally{java.util.Arrays.fill(secret,'\0');}
                String failure=problem;runOnUiThread(()->{if(accountsView!=token||isFinishing()||isDestroyed())return;if(failure!=null)status.setText("Ошибка смены пароля: "+failure);else{status.setText("Пароль изменён: "+name);toast("Пароль изменён");}});
            },"account-password").start();
        }));dialog.show();
    }
    private void webScreen() {
        layout("Web-доступ");
        note("Браузер: только чтение. WebDAV (/dav/): чтение, запись включается отдельно. Это HTTP, не FTP. Пароль и файлы передаются без шифрования! Используйте только доверенную локальную сеть; не открывайте порт в интернет.");
        note(tree==null?"Сначала выберите папку на главном экране.":"Публикуется корень последней выбранной папки. Сервер работает, пока открыто приложение.");
        EditText port=field("Порт (по умолчанию 8080)",false);
        body.addView(button("Управление локальными учётными записями",this::accountsScreen));
        CheckBox anonymous=new CheckBox(this); anonymous.setText("Анонимный доступ (любой в сети, только чтение)"); body.addView(anonymous);
        CheckBox writes=new CheckBox(this); writes.setText("Разрешить запись и удаление через WebDAV (только с учётной записью)"); body.addView(writes);
        TextView status=text(webServer==null?"Сервер остановлен":"Сервер запущен. Адреса: "+localAddresses(webServer.getListeningPort()),15); body.addView(status);
        body.addView(button("Запустить",()->{
            if(webServer!=null){toast("Сервер уже запущен");return;} if(tree==null){toast("Сначала выберите папку");return;}
            int number;
            try { number=port.getText().toString().trim().isEmpty()?8080:Integer.parseInt(port.getText().toString().trim()); if(number<1024||number>65535)throw new IllegalArgumentException(); }
            catch(Exception ex){toast("Укажите порт от 1024 до 65535");return;}
            boolean anon=anonymous.isChecked(), writable=writes.isChecked(); if(anon && writable){toast("В анонимном режиме запись запрещена");return;}
            try{if(!anon&&new LocalAccounts(this).list().isEmpty()){toast("Сначала создайте локальную учётную запись");return;}}catch(Exception ex){error(ex);return;}
            Uri selected=tree;
            new AlertDialog.Builder(this).setTitle("Открыть доступ в сети?").setMessage(anon?"Любой пользователь сети сможет читать файлы выбранной папки. Соединение не шифруется.":(writable?"Учётные записи с разрешением записи смогут перезаписывать и удалять файлы. При сбое записи файл может повредиться. ":"")+"Пароль и файлы передаются без шифрования. Не используйте в недоверенной сети или интернете.")
              .setNegativeButton("Отмена",null).setPositiveButton("Запустить",(d,w)->{
                if(webServer!=null) return;
                try { WebFilesServer server=new WebFilesServer(getApplicationContext(),selected,number,anon,writable,getCacheDir());server.start(10000,false);webServer=server;status.setText("Сервер запущен: "+localAddresses(number)+"\nДля WebDAV добавьте /dav/ к адресу."); }
                catch(Exception ex){error(ex);}
              }).show();
        }));
        body.addView(button("Остановить",()->{stopWeb();status.setText("Сервер остановлен");}));
        body.addView(button("Назад",this::home));
    }
    private String localAddresses(int port) {
        ArrayList<String> result=new ArrayList<>();
        try { java.util.Enumeration<java.net.NetworkInterface> all=java.net.NetworkInterface.getNetworkInterfaces();
            while(all!=null && all.hasMoreElements()){java.net.NetworkInterface iface=all.nextElement(); if(!iface.isUp()||iface.isLoopback())continue; java.util.Enumeration<java.net.InetAddress> addresses=iface.getInetAddresses(); while(addresses.hasMoreElements()){java.net.InetAddress address=addresses.nextElement();if(address instanceof java.net.Inet4Address&&!address.isLoopbackAddress())result.add("http://"+address.getHostAddress()+":"+port+"/");}}
        } catch(Exception ignored) {} return result.isEmpty()?"IP-адрес не найден":android.text.TextUtils.join("\n",result);
    }
    private void stopWeb(){if(webServer!=null){webServer.stop();webServer=null;}}
    @Override protected void onStop(){
        if(vncClient!=null){stopVnc();if(vncUiReset!=null)vncUiReset.run();}
        if(interactiveSsh!=null){stopInteractiveSsh();if(shellUiReset!=null)shellUiReset.run();}
        if(mediaPlayer!=null){mediaPlayer.stopPlayback();mediaStopped=true;if(videoUi!=null)videoUi.previewReady=false;if(mediaController!=null)mediaController.hide();}
        super.onStop();
    }
    @Override protected void onDestroy(){stopVnc();stopInteractiveSsh();mediaToken=null;stopMedia();cancelScan();cancelSearch();cancelHash();cancelZip();cancelKeySsh();cancelVideo();stopWeb();if(sshTunnel!=null){sshTunnel.stop();sshTunnel=null;}if(reverseTunnel!=null){reverseTunnel.stop();reverseTunnel=null;}super.onDestroy();}
    private void pingScreen(){ layout("Проверка сети"); note("ICMP ping: доступность зависит от сети и устройства."); EditText host=new EditText(this); host.setSingleLine(); host.setHint("Адрес или домен"); body.addView(host); TextView result=text("",15); body.addView(button("Проверить",()->{String h=host.getText().toString().trim(); if(!h.matches("[a-zA-Z0-9.:-]{1,253}") || h.startsWith("-")){result.setText("Некорректный адрес");return;} result.setText("Проверка…"); new Thread(()->{String output; try { Process p=new ProcessBuilder("ping","-c","1","-W","3",h).redirectErrorStream(true).start(); ByteArrayOutputStream b=new ByteArrayOutputStream(); try(InputStream in=p.getInputStream()){byte[] buf=new byte[1024];int n;while((n=in.read(buf))!=-1 && b.size()<8192)b.write(buf,0,n);} p.waitFor();output=b.toString("UTF-8"); }catch(Exception ex){output="Ошибка: "+ex.getMessage();} String finalOutput=output;runOnUiThread(()->result.setText(finalOutput));}).start();})); body.addView(result); body.addView(button("Назад",this::home)); }
    private void cancelVideo(){if(videoCancellation!=null){videoCancellation.cancel();videoCancellation=null;}}
    private void videoEditorScreen(){
        layout("Видео · обрезка MP4");
        note("Обрезка без перекодирования: MP4 с одной видеодорожкой H.264/H.265 и, если звук сохраняется, не более одной аудиодорожки AAC. Неизвестный размер и файлы больше 512 МиБ не поддерживаются. Понадобится свободное место в кэше.");
        note("Начало переносится к предыдущему ключевому кадру; конец ограничен временем кадра. Субтитры, дополнительные дорожки и метаданные могут не сохраниться. Выберите НОВЫЙ файл при сохранении — перезапись может повредить исходник. Поворот экрана отменяет операцию.");
        VideoUi ui=new VideoUi();videoUi=ui;
        ui.status=text("Выберите исходный MP4",15);ui.choose=button("Выбрать видео",()->{});body.addView(ui.choose);
        ui.preview=new VideoView(this);ui.preview.setVisibility(View.GONE);mediaPlayer=ui.preview;mediaStopped=true;body.addView(ui.preview,new LinearLayout.LayoutParams(-1,dp(240)));
        MediaController controls=new MediaController(this);mediaController=controls;controls.setAnchorView(ui.preview);ui.preview.setMediaController(controls);
        ui.preview.setOnPreparedListener(player->{if(videoUi==ui&&mediaPlayer==ui.preview&&!mediaStopped&&!ui.busy){ui.previewReady=true;ui.preview.start();controls.show(3000);}});
        ui.preview.setOnErrorListener((player,what,extra)->{if(videoUi==ui){ui.previewReady=false;ui.status.setText("Не удалось воспроизвести видео системным проигрывателем.");}return true;});
        ui.previewButton=button("Предпросмотр выбранного видео",()->{if(ui.busy||ui.source==null)return;ui.preview.setVisibility(View.VISIBLE);ui.status.setText("Подготовка предпросмотра…");ui.previewReady=false;mediaStopped=false;ui.preview.setVideoURI(ui.source);});ui.previewButton.setEnabled(false);body.addView(ui.previewButton);
        ui.start=field("Начало в миллисекундах",false);ui.start.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);ui.start.setText("0");
        ui.end=field("Конец в миллисекундах (например 10000 = 10 сек)",false);ui.end.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        body.addView(button("Начало по позиции плеера",()->markVideoPosition(ui,true)));
        body.addView(button("Конец по позиции плеера",()->markVideoPosition(ui,false)));
        ui.duration=button("Определить длительность и установить конец",()->readVideoDuration(ui));ui.duration.setEnabled(false);body.addView(ui.duration);
        ui.mute=new CheckBox(this);ui.mute.setText("Сохранить фрагмент без звука");body.addView(ui.mute);
        ui.save=button("Выбрать файл и обрезать",()->{});ui.save.setEnabled(false);ui.cancel=button("Отменить обработку",()->{});ui.cancel.setEnabled(false);
        body.addView(ui.save);body.addView(ui.cancel);body.addView(ui.status);body.addView(button("Назад",this::home));
        ui.choose.setOnClickListener(v->{
            if(ui.busy)return;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/mp4");
            try{startActivityForResult(i,VIDEO_OPEN);}catch(Exception ex){error(ex);}
        });
        ui.save.setOnClickListener(v->{
            if(ui.busy||ui.source==null)return;long start,end;
            try{start=Long.parseLong(ui.start.getText().toString().trim());end=Long.parseLong(ui.end.getText().toString().trim());if(start<0||end<=start||end>Long.MAX_VALUE/1000)throw new IllegalArgumentException();}
            catch(Exception ex){toast("Введите начало и конец в миллисекундах; конец должен быть больше начала");return;}
            Uri source=ui.source;boolean mute=ui.mute.isChecked();new AlertDialog.Builder(this).setTitle("Сохранить фрагмент")
                .setMessage("Выберите новое имя и не выбирайте исходный файл. Если операция записи прервётся, файл назначения может быть неполным.")
                .setNegativeButton("Отмена",null).setPositiveButton("Продолжить",(d,w)->{
                    if(videoUi!=ui)return;pendingVideo=new PendingVideo(ui,source,start,end,mute);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/mp4");i.putExtra(Intent.EXTRA_TITLE,"trimmed.mp4");
                    try{startActivityForResult(i,VIDEO_SAVE);}catch(Exception ex){pendingVideo=null;error(ex);}
                }).show();
        });
        ui.cancel.setOnClickListener(v->{if(videoCancellation!=null)videoCancellation.cancel();ui.cancel.setEnabled(false);ui.status.setText("Отмена… Файл назначения, если запись уже началась, может быть неполным.");});
    }
    private void markVideoPosition(VideoUi ui,boolean start){
        if(ui.busy||!ui.previewReady||mediaStopped||mediaPlayer!=ui.preview){toast("Сначала запустите предпросмотр и установите нужную позицию");return;}
        int position=ui.preview.getCurrentPosition();if(position<0){toast("Позиция недоступна");return;}
        (start?ui.start:ui.end).setText(Integer.toString(position));ui.status.setText((start?"Начало":"Конец")+" установлено: "+position+" мс. Начало при обрезке может сместиться к предыдущему ключевому кадру.");
    }
    private void readVideoDuration(VideoUi ui){
        if(ui.busy||ui.source==null)return;Uri source=ui.source;Object token=new Object();ui.durationRequest=token;String previous=ui.end.getText().toString();ui.duration.setEnabled(false);ui.status.setText("Чтение длительности…");
        new Thread(()->{long value=0;String problem=null;try{value=VideoInfo.duration(getApplicationContext(),source);}catch(Exception ex){problem=ex.getMessage();}
            long duration=value;String failure=problem;runOnUiThread(()->{
                if(videoUi!=ui||ui.durationRequest!=token||isFinishing()||isDestroyed())return;ui.durationRequest=null;if(!ui.busy)ui.duration.setEnabled(true);if(ui.busy)return;
                if(failure!=null){ui.status.setText("Длительность недоступна: "+failure);return;}
                if(previous.equals(ui.end.getText().toString())){ui.end.setText(Long.toString(duration));ui.status.setText("Длительность: "+duration+" мс; конец установлен. Проверьте диапазон перед сохранением.");}
                else ui.status.setText("Длительность: "+duration+" мс. Поле конца изменено вручную и не заменено.");
            });
        },"video-duration").start();
    }
    private void startVideoTrim(PendingVideo pending,Uri target){
        VideoUi ui=pending.ui;if(ui.busy)return;
        if(pending.source.equals(target)){toast("Выберите другой файл");return;}
        android.os.CancellationSignal signal=new android.os.CancellationSignal();videoCancellation=signal;ui.durationRequest=null;ui.busy=true;ui.preview.stopPlayback();ui.previewReady=false;mediaStopped=true;ui.previewButton.setEnabled(false);ui.choose.setEnabled(false);ui.save.setEnabled(false);ui.duration.setEnabled(false);ui.cancel.setEnabled(true);ui.status.setText("Обработка…");
        new Thread(()->{
            VideoTrimmer.Result result=null;String failure=null;
            try{result=VideoTrimmer.trim(getContentResolver(),pending.source,target,getCacheDir(),pending.start,pending.end,pending.mute,signal);}
            catch(android.os.OperationCanceledException ex){failure="Отменено. Файл назначения, если запись началась, может быть неполным.";}
            catch(Exception | OutOfMemoryError ex){failure="Ошибка: "+ex.getMessage()+". Файл назначения, если запись началась, может быть неполным.";}
            VideoTrimmer.Result answer=result;String message=failure;
            runOnUiThread(()->{
                if(videoUi!=ui||isDestroyed()||isFinishing())return;if(videoCancellation==signal)videoCancellation=null;
                ui.busy=false;ui.previewButton.setEnabled(ui.source!=null);ui.choose.setEnabled(true);ui.save.setEnabled(ui.source!=null);ui.duration.setEnabled(ui.source!=null);ui.cancel.setEnabled(false);
                if(answer==null)ui.status.setText(message);else ui.status.setText("Фрагмент сохранён. Фактическое начало: "+(answer.actualStartUs/1000)+" мс; видеокадров: "+answer.frames+". Проверьте результат в проигрывателе.");
            });
        },"video-trim").start();
    }
    private void paintScreen(){
        layout("Paint");
        note("Холст 1200 × 1200. Картинка вписывается в квадрат на белый фон, прозрачность и метаданные не сохраняются. Выбирайте новое имя при сохранении: исходник может быть перезаписан в системном диалоге.");
        PaintView view=new PaintView(this);canvas=view;body.addView(view,new LinearLayout.LayoutParams(-1,dp(360)));
        TextView currentColor=text("Кисть: чёрный",15);body.addView(currentColor);
        LinearLayout palette=new LinearLayout(this);body.addView(palette);
        palette.addView(button("Чёрный",()->{view.color=Color.BLACK;currentColor.setText("Кисть: чёрный");}));
        palette.addView(button("Красный",()->{view.color=Color.RED;currentColor.setText("Кисть: красный");}));
        palette.addView(button("Синий",()->{view.color=Color.BLUE;currentColor.setText("Кисть: синий");}));
        LinearLayout palette2=new LinearLayout(this);body.addView(palette2);
        palette2.addView(button("Зелёный",()->{view.color=Color.rgb(0,128,0);currentColor.setText("Кисть: зелёный");}));
        palette2.addView(button("Ластик",()->{view.color=Color.WHITE;currentColor.setText("Ластик (белая кисть)");}));
        body.addView(button("Свой цвет (#RRGGBB)",()->choosePaintColor(view,currentColor)));
        TextView width=text("Толщина: 8",15);body.addView(width);
        SeekBar size=new SeekBar(this);size.setMax(57);size.setProgress(5);body.addView(size);
        size.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar b,int value,boolean fromUser){view.width=value+3;width.setText("Толщина: "+(value+3));}public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}});
        LinearLayout tools=new LinearLayout(this);body.addView(tools);
        tools.addView(button("Отменить",()->{if(!view.undo())toast("Нет действия для отмены");}));
        tools.addView(button("Повторить",()->{if(!view.redo())toast("Нет действия для повтора");}));
        tools.addView(button("Очистить",()->new AlertDialog.Builder(this).setMessage("Очистить холст?").setNegativeButton("Отмена",null).setPositiveButton("Очистить",(d,w)->view.clear()).show()));
        body.addView(button("Фильтр: чёрно-белый",()->applyPaintFilter(view,true)));
        body.addView(button("Фильтр: инверсия цветов",()->applyPaintFilter(view,false)));
        body.addView(button("Повернуть холст на 90° вправо",()->{if(!view.transform(false))toast("Недостаточно памяти для поворота");}));
        body.addView(button("Отразить холст по горизонтали",()->{if(!view.transform(true))toast("Недостаточно памяти для отражения");}));
        body.addView(button("Открыть картинку",()->{
            Runnable choose=()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/*");try{startActivityForResult(i,PAINT_OPEN_IMAGE);}catch(Exception ex){error(ex);}};
            if(view.revision==0)choose.run();
            else new AlertDialog.Builder(this).setMessage("Открытие картинки заменит текущий холст. Сначала сохраните его при необходимости.").setNegativeButton("Отмена",null).setPositiveButton("Продолжить",(d,w)->{if(canvas==view)choose.run();}).show();
        }));
        body.addView(button("Сохранить PNG",()->choosePaintDestination(false)));
        body.addView(button("Сохранить JPEG",()->choosePaintDestination(true)));
        body.addView(button("Назад",this::home));
    }
    private void applyPaintFilter(PaintView target,boolean grayscale){
        Bitmap snapshot;long revision=target.revision;
        try{snapshot=target.bitmap.copy(Bitmap.Config.ARGB_8888,true);if(snapshot==null)throw new OutOfMemoryError();}
        catch(OutOfMemoryError ex){toast("Недостаточно памяти для фильтра");return;}
        toast("Обработка изображения…");new Thread(()->{
            String failure=null;try{PaintFilters.apply(snapshot,grayscale);}catch(Exception | OutOfMemoryError ex){failure=ex.getMessage()==null?"Недостаточно памяти или ошибка обработки":ex.getMessage();}
            String problem=failure;runOnUiThread(()->{
                if(canvas!=target||isDestroyed()||isFinishing()){snapshot.recycle();return;}
                if(problem!=null){snapshot.recycle();toast("Ошибка фильтра: "+problem);return;}
                if(target.revision!=revision||target.drawingStroke){snapshot.recycle();toast("Холст изменился во время обработки; фильтр не применён");return;}
                target.replaceWithSnapshot(snapshot);toast("Фильтр применён; действие можно отменить");
            });
        },"paint-filter").start();
    }
    private void choosePaintDestination(boolean jpeg){
        String type=jpeg?"JPEG":"PNG";
        new AlertDialog.Builder(this).setTitle("Сохранить "+type).setMessage("Выберите новое имя и не выбирайте исходный файл: сохранение может перезаписать его. "+(jpeg?"JPEG сжимает изображение с потерями, прозрачность не сохраняется.":""))
            .setNegativeButton("Отмена",null).setPositiveButton("Выбрать файл",(d,w)->{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(jpeg?"image/jpeg":"image/png");intent.putExtra(Intent.EXTRA_TITLE,jpeg?"drawing.jpg":"drawing.png");try{startActivityForResult(intent,jpeg?SAVE_JPEG:SAVE_IMAGE);}catch(Exception ex){error(ex);}}).show();
    }
    private void choosePaintColor(PaintView view,TextView currentColor){
        EditText input=new EditText(this);input.setSingleLine();input.setHint("RRGGBB, например FF8800");input.setText(String.format(java.util.Locale.ROOT,"%06X",view.color&0xffffff));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Цвет кисти").setView(input).setNegativeButton("Отмена",null).setPositiveButton("Применить",null).create();
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{int color=PaintColors.parse(input.getText().toString());if(canvas!=view){dialog.dismiss();return;}view.color=color;currentColor.setText(String.format(java.util.Locale.ROOT,"Кисть: #%06X",color&0xffffff));dialog.dismiss();}catch(IllegalArgumentException ex){input.setError(ex.getMessage());}}));dialog.show();
    }
    private void loadPaint(Uri uri,PaintView target){
        long revision=target.revision;toast("Открытие изображения…");
        new Thread(()->{
            Bitmap image=null;String failure=null;
            try{image=ImagePreview.load(getContentResolver(),uri);}catch(Exception | OutOfMemoryError e){failure=e.getMessage()==null?"Недостаточно памяти":e.getMessage();}
            Bitmap result=image;String message=failure;
            runOnUiThread(()->{
                if(canvas!=target||isFinishing()||isDestroyed()){if(result!=null)result.recycle();return;}
                if(result==null){toast("Не удалось открыть: "+message);return;}
                if(target.revision!=revision){result.recycle();toast("Холст изменён во время загрузки; изображение не применено");return;}
                try{target.importImage(result);toast("Картинка добавлена на холст");}finally{result.recycle();}
            });
        },"paint-open").start();
    }
    private void savePaint(Uri uri,PaintView target,boolean jpeg){
        Bitmap snapshot;
        try{snapshot=target.bitmap.copy(Bitmap.Config.ARGB_8888,false);if(snapshot==null)throw new OutOfMemoryError();}
        catch(OutOfMemoryError error){toast("Недостаточно памяти для сохранения");return;}
        toast("Сохранение…");
        new Thread(()->{
            String message;
            try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){
                if(out==null||!PaintExport.compress(snapshot,out,jpeg))throw new IOException("Ошибка записи");message="Рисунок сохранён";
            }catch(Exception ex){message="Ошибка сохранения; файл назначения может быть неполным: "+ex.getMessage();}
            finally{snapshot.recycle();}
            String answer=message;runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())toast(answer);});
        },"paint-save").start();
    }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();} private void error(Exception e){toast("Ошибка: "+e.getMessage());}
    @Override public void onBackPressed(){if(zipSelecting){clearZipSelection();list();return;}if(textUi!=null){leaveText(textUi);return;}if(zipScreenVisible && current!=null){list();return;}if(bookmarkScreenVisible){home();return;}if(propertiesVisible && current!=null){list();return;}if(searchScreenVisible && current!=null){list();return;}if(mediaScreen && current!=null){list();return;}if(fileScreen && current!=null && !parents.empty()){current=parents.pop();list();}else{current=null;home();}}
    static class Entry { Uri uri; String name,mime; long size; Entry(Uri u,String n,String m,long s){uri=u;name=n==null?"Без имени":n;mime=m==null?"application/octet-stream":m;size=s;} boolean dir(){return DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);} }
    static class PaintView extends View {
        private static final int SIDE=1200;
        Bitmap bitmap=Bitmap.createBitmap(SIDE,SIDE,Bitmap.Config.ARGB_8888), previous, nextRedo;
        Canvas drawing=new Canvas(bitmap);Paint brush=new Paint(Paint.ANTI_ALIAS_FLAG);int color=Color.BLACK,width=8;long revision;float px,py;boolean drawingStroke;
        PaintView(Context context){super(context);drawing.drawColor(Color.WHITE);setBackgroundColor(Color.LTGRAY);}
        private void checkpoint(){
            if(nextRedo!=null){nextRedo.recycle();nextRedo=null;}
            if(previous!=null){previous.recycle();previous=null;}
            try{previous=bitmap.copy(Bitmap.Config.ARGB_8888,true);}catch(OutOfMemoryError ignored){previous=null;}
        }
        void clear(){checkpoint();drawing.drawColor(Color.WHITE);revision++;invalidate();}
        boolean undo(){if(previous==null||drawingStroke)return false;if(nextRedo!=null)nextRedo.recycle();nextRedo=bitmap;bitmap=previous;previous=null;drawing=new Canvas(bitmap);revision++;invalidate();return true;}
        boolean redo(){if(nextRedo==null||drawingStroke)return false;if(previous!=null)previous.recycle();previous=bitmap;bitmap=nextRedo;nextRedo=null;drawing=new Canvas(bitmap);revision++;invalidate();return true;}
        void replaceWithSnapshot(Bitmap next){
            if(nextRedo!=null){nextRedo.recycle();nextRedo=null;}if(previous!=null)previous.recycle();previous=bitmap;bitmap=next;drawing=new Canvas(bitmap);revision++;invalidate();
        }
        boolean transform(boolean flip){
            Bitmap next=null;
            try{next=Bitmap.createBitmap(SIDE,SIDE,Bitmap.Config.ARGB_8888);Canvas output=new Canvas(next);
                output.translate(SIDE/2f,SIDE/2f);if(flip)output.scale(-1,1);else output.rotate(90);output.translate(-SIDE/2f,-SIDE/2f);output.drawBitmap(bitmap,0,0,null);
            }catch(OutOfMemoryError e){if(next!=null)next.recycle();return false;}
            if(nextRedo!=null){nextRedo.recycle();nextRedo=null;}if(previous!=null)previous.recycle();previous=bitmap;bitmap=next;drawing=new Canvas(bitmap);revision++;invalidate();return true;
        }
        void importImage(Bitmap image){
            checkpoint();drawing.drawColor(Color.WHITE);
            float scale=Math.min((float)SIDE/image.getWidth(),(float)SIDE/image.getHeight());float w=image.getWidth()*scale,h=image.getHeight()*scale;
            Paint filter=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);drawing.drawBitmap(image,null,new RectF((SIDE-w)/2,(SIDE-h)/2,(SIDE+w)/2,(SIDE+h)/2),filter);revision++;invalidate();
        }
        @Override protected void onDraw(Canvas c){super.onDraw(c);float side=Math.min(getWidth(),getHeight());float left=(getWidth()-side)/2,top=(getHeight()-side)/2;c.drawBitmap(bitmap,null,new RectF(left,top,left+side,top+side),null);}
        @Override public boolean onTouchEvent(MotionEvent e){
            float side=Math.min(getWidth(),getHeight());if(side<=0)return false;float left=(getWidth()-side)/2,top=(getHeight()-side)/2;
            float x=Math.max(0,Math.min(SIDE,(e.getX()-left)*SIDE/side)),y=Math.max(0,Math.min(SIDE,(e.getY()-top)*SIDE/side));
            if(e.getAction()==MotionEvent.ACTION_DOWN){if(e.getX()<left||e.getX()>left+side||e.getY()<top||e.getY()>top+side)return false;getParent().requestDisallowInterceptTouchEvent(true);checkpoint();drawingStroke=true;px=x;py=y;brush.setColor(color);brush.setStrokeWidth(width);brush.setStrokeCap(Paint.Cap.ROUND);drawing.drawPoint(x,y,brush);revision++;invalidate();return true;}
            if((e.getAction()==MotionEvent.ACTION_MOVE||e.getAction()==MotionEvent.ACTION_UP)&&drawingStroke){brush.setColor(color);brush.setStrokeWidth(width);brush.setStrokeCap(Paint.Cap.ROUND);drawing.drawLine(px,py,x,y,brush);px=x;py=y;revision++;invalidate();if(e.getAction()==MotionEvent.ACTION_UP){drawingStroke=false;getParent().requestDisallowInterceptTouchEvent(false);performClick();}return true;}
            if(e.getAction()==MotionEvent.ACTION_CANCEL){drawingStroke=false;getParent().requestDisallowInterceptTouchEvent(false);return true;}return drawingStroke;
        }
        @Override public boolean performClick(){super.performClick();return true;}
    }
}
