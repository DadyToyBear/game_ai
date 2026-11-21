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
    private static final int OPEN_TREE=1, SAVE_IMAGE=2, SFTP_DOWNLOAD=3, SFTP_UPLOAD=4, FTP_DOWNLOAD=5, FTP_UPLOAD=6, DAV_DOWNLOAD=7, DAV_UPLOAD=8, PAINT_OPEN_IMAGE=9, VIDEO_OPEN=10, VIDEO_SAVE=11, SMB_DOWNLOAD=12, SMB_UPLOAD=13;
    private LinearLayout root, body;
    private Uri tree, current;
    private final Stack<Uri> parents = new Stack<>();
    private PaintView canvas;
    private boolean fileScreen;
    private boolean mediaScreen;
    private VideoView mediaPlayer;
    private MediaController mediaController;
    private boolean mediaStopped;
    private Object mediaToken;
    private WebFilesServer webServer;
    private Entry clipboard; private boolean cut;
    private Object accountsView;
    private Object trashView;
    private android.os.CancellationSignal scanCancellation;
    private android.os.CancellationSignal videoCancellation;
    private VideoUi videoUi; private PendingVideo pendingVideo;
    private static final class VideoUi { Uri source;EditText start,end;TextView status;Button choose,save,cancel;boolean busy; }
    private static final class PendingVideo { final VideoUi ui;final Uri source;final long start,end;PendingVideo(VideoUi ui,Uri source,long start,long end){this.ui=ui;this.source=source;this.start=start;this.end=end;} }
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
    private TunnelUi tunnelUi;
    private static final class TunnelUi { TextView status; Button start,stop; }
    private PendingSftp pendingSftp;
    private static final class SftpUi {
        EditText host,port,user,password,path; TextView status; LinearLayout entries; Button list,upload; boolean busy;
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
        stopInteractiveSsh();shellUiReset=null;cancelScan();cancelVideo();videoUi=null;pendingVideo=null;trashView=null;accountsView=null;
        stopMedia();mediaToken=null;mediaScreen=false;canvas=null;
        sftpUi=null; pendingSftp=null; ftpUi=null; pendingFtp=null; davUi=null; pendingDav=null; smbUi=null; pendingSmb=null; tunnelUi=null;
        fileScreen="Файлы".equals(title);
        root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(18),dp(18),dp(18),dp(10)); root.setBackgroundColor(Color.rgb(247,249,252)); setContentView(root);
        TextView heading=text(title,26); heading.setTypeface(null,1); root.addView(heading);
        ScrollView scroll=new ScrollView(this); root.addView(scroll, new LinearLayout.LayoutParams(-1,0,1));
        body=new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(0,dp(16),0,0); scroll.addView(body);
    }
    private void note(String s) { TextView t=text(s,16); t.setPadding(0,dp(8),0,dp(8)); body.addView(t); }
    private void home() {
        layout("Aurora Files"); note("Файлы и инструменты · первая версия");
        body.addView(button("Открыть папку", () -> { Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION); startActivityForResult(i,OPEN_TREE); }));
        body.addView(button("Корзина выбранной папки", this::trashScreen));
        body.addView(button("Анализ хранилища", this::storageScreen));
        body.addView(button("Управление приложениями", () -> {
            try { startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)); }
            catch(Exception ex) { error(ex); }
        }));
        body.addView(button("SSH — выполнить команду", this::sshScreen));
        body.addView(button("SSH — интерактивная оболочка", this::interactiveSshScreen));
        body.addView(button("SFTP — удалённые файлы", this::sftpScreen));
        body.addView(button("FTP / FTPS — удалённые файлы", this::ftpScreen));
        body.addView(button("WebDAV — удалённые файлы", this::davClientScreen));
        body.addView(button("SMB3 — папки Windows / NAS", this::smbScreen));
        body.addView(button("SSH — проброс порта", this::tunnelScreen));
        body.addView(button("Web-доступ к файлам", this::webScreen));
        body.addView(button("Paint — рисование", this::paintScreen));
        body.addView(button("Видео — обрезка MP4", this::videoEditorScreen));
        body.addView(button("Проверка сети · ping", this::pingScreen));
        body.addView(button("О приложении", () -> { layout("О приложении"); note("Независимый файловый менеджер. Для доступа к файлам выберите папку в системном диалоге Android.\n\nSSH, SFTP, FTP/FTPS и WebDAV доступны в ограниченных версиях. Видеоредактор пока умеет только обрезать MP4; удалённый рабочий стол не реализован."); body.addView(button("Назад",this::home)); }));
    }
    @Override protected void onActivityResult(int req,int result,Intent data) {
        super.onActivityResult(req,result,data);
        if(req==VIDEO_OPEN){
            if(videoUi!=null && result==RESULT_OK && data!=null && data.getData()!=null){videoUi.source=data.getData();videoUi.status.setText("Исходный видеофайл выбран. Укажите начало и конец в миллисекундах.");videoUi.save.setEnabled(true);}return;
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
        if(req==SAVE_IMAGE && canvas!=null) savePaint(data.getData(),canvas);
        if(req==PAINT_OPEN_IMAGE && canvas!=null) loadPaint(data.getData(),canvas);
    }
    private void list() {
        layout("Файлы"); body.addView(button("← Назад", () -> { if(parents.empty()) home(); else {current=parents.pop(); list();} }));
        if(clipboard!=null) body.addView(button((cut?"Вставить (переместить): ":"Вставить (копировать): ")+clipboard.name, this::paste));
        body.addView(button("＋ Новая папка", () -> input("Имя папки", name -> { try { if(DocumentsContract.createDocument(getContentResolver(),current,DocumentsContract.Document.MIME_TYPE_DIR,name)==null) throw new IOException("Создание не поддерживается"); list(); } catch(Exception e){error(e);} })));
        try {
            String id=DocumentsContract.getDocumentId(current); Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,id);
            ArrayList<Entry> entries=new ArrayList<>();
            try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)) {
                if(c==null) throw new IOException("Папка недоступна");
                while(c.moveToNext()) entries.add(new Entry(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)),c.getString(1),c.getString(2),c.isNull(3)?-1:c.getLong(3)));
            }
            Collections.sort(entries,(a,b)-> { int x=Boolean.compare(b.dir(),a.dir()); return x!=0?x:a.name.compareToIgnoreCase(b.name); });
            if(entries.isEmpty()) note("Папка пуста");
            for(Entry e:entries) { TextView row=text((e.dir()?"📁  ":"📄  ")+e.name+(e.dir()||e.size<0?"":"  ·  "+android.text.format.Formatter.formatFileSize(this,e.size)),16); row.setPadding(dp(8),dp(16),dp(8),dp(16)); body.addView(row); row.setOnClickListener(v->{ if(e.dir()){parents.push(current);current=e.uri;list();} else open(e); }); row.setOnLongClickListener(v->{actions(e);return true;}); }
        } catch(Exception e) { error(e); }
    }
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
        note("Предпросмотр уменьшен для экономии памяти. Для неподдерживаемых форматов используйте другое приложение.");
        TextView status=text("Загрузка…",15);body.addView(status);
        ImageView image=new ImageView(this);image.setAdjustViewBounds(true);image.setScaleType(ImageView.ScaleType.FIT_CENTER);body.addView(image,new LinearLayout.LayoutParams(-1,dp(400)));
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
        VideoView player=new VideoView(this);mediaPlayer=player;mediaStopped=false;
        body.addView(player,new LinearLayout.LayoutParams(-1,dp(mime.startsWith("audio/")?160:300)));
        MediaController controls=new MediaController(this);mediaController=controls;controls.setAnchorView(player);player.setMediaController(controls);
        player.setOnPreparedListener(mp->{if(mediaPlayer!=player)return;status.setText("Готово · управление доступно в плеере");player.start();controls.show(3000);});
        player.setOnCompletionListener(mp->{if(mediaPlayer==player)status.setText("Воспроизведение завершено");});
        player.setOnErrorListener((mp,what,extra)->{if(mediaPlayer==player)status.setText("Не удалось воспроизвести файл. Попробуйте другое приложение.");return true;});
        body.addView(button("Воспроизвести / заново",()->{if(mediaPlayer!=player)return;if(mediaStopped){mediaStopped=false;status.setText("Подготовка…");player.setVideoURI(entry.uri);}else{player.start();controls.show(3000);}}));
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
        String[] choices={"Открыть", "Копировать", "Вырезать", "Сжать в ZIP", "Распаковать ZIP", "Переименовать", "В корзину", "Удалить навсегда", "Поделиться"};
        new AlertDialog.Builder(this).setTitle(e.name).setItems(choices,(d,n)->{
            if(n==0){if(e.dir()){parents.push(current);current=e.uri;list();}else open(e);}
            if(n==1||n==2){clipboard=e;cut=n==2;toast(cut?"Выбрано для перемещения":"Выбрано для копирования");list();}
            if(n==3) input("Имя ZIP-архива",name->{Uri dest=current;Uri selectedTree=tree;runFileTask(()->new FileOperations(getContentResolver(),selectedTree).zip(new FileOperations.Item(e.uri,e.name,e.mime),dest,name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")?name:name+".zip"),"Архив создан");});
            if(n==4){if(e.dir()||!e.name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")){toast("Выберите ZIP-файл");return;} input("Имя новой папки",name->{Uri dest=current;Uri selectedTree=tree;runFileTask(()->new FileOperations(getContentResolver(),selectedTree).unzip(new FileOperations.Item(e.uri,e.name,e.mime),dest,name),"Архив распакован");});}
            if(n==5) input("Новое имя",name->{try{if(DocumentsContract.renameDocument(getContentResolver(),e.uri,name)==null)throw new IOException("Переименование не поддерживается");list();}catch(Exception ex){error(ex);}});
            if(n==6){Uri selectedTree=tree,parent=current;if(clipboard!=null&&clipboard.uri.equals(e.uri))clipboard=null;runFileTask(()->new TrashStore(this).moveToTrash(selectedTree,parent,e.uri),"Перемещено в корзину");}
            if(n==7) new AlertDialog.Builder(this).setMessage("Удалить «"+e.name+"» навсегда, минуя корзину? Операция необратима.").setNegativeButton("Отмена",null).setPositiveButton("Удалить",(x,y)->{try{if(!DocumentsContract.deleteDocument(getContentResolver(),e.uri))throw new IOException("Удаление не поддерживается");list();}catch(Exception ex){error(ex);}}).show();
            if(n==8 && !e.dir()){Intent i=new Intent(Intent.ACTION_SEND);i.setType(e.mime);i.putExtra(Intent.EXTRA_STREAM,e.uri);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"Поделиться"));}
        }).show();
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
        layout("Текст · "+entry.name); note("UTF-8, максимум 1 МиБ. Сохранение перезаписывает исходный файл; рекомендуется сделать копию.");
        EditText editor=new EditText(this);editor.setGravity(Gravity.TOP|Gravity.START);editor.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);editor.setMinLines(12);body.addView(editor);
        Button save=button("Сохранить",()->{});save.setEnabled(false);body.addView(save);body.addView(button("Назад",this::list));
        new Thread(()->{try(InputStream in=getContentResolver().openInputStream(entry.uri)){if(in==null)throw new IOException("Файл недоступен");ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>1048576)throw new IOException("Файл больше 1 МиБ");out.write(b,0,n);}String value=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();runOnUiThread(()->{if(!isDestroyed()){editor.setText(value);save.setEnabled(true);}});}catch(Exception ex){runOnUiThread(()->error(ex));}},"text-read").start();
        save.setOnClickListener(v->{byte[] data=editor.getText().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(data.length>1048576){toast("Текст больше 1 МиБ");return;}save.setEnabled(false);new Thread(()->{String message;try(OutputStream out=getContentResolver().openOutputStream(entry.uri,"wt")){if(out==null)throw new IOException("Запись недоступна");out.write(data);message="Сохранено";}catch(Exception ex){message="Ошибка сохранения; файл мог быть изменён: "+ex.getMessage();}String answer=message;runOnUiThread(()->{if(!isDestroyed()){toast(answer);save.setEnabled(true);}});},"text-save").start();});
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
        note("Парольный вход. Каждая операция создаёт отдельное SSH-соединение: проверяйте отпечаток сервера. Поля не сохраняются; при повороте экрана выбор файла может сброситься.");
        SftpUi ui=new SftpUi();sftpUi=ui;
        ui.host=field("Адрес сервера",false); ui.port=field("Порт (22)",false); ui.user=field("Пользователь",false); ui.password=field("Пароль",true); ui.path=field("Папка на сервере",false);ui.path.setText("/");
        ui.status=text("",15); ui.list=button("Показать файлы",()->{}); ui.upload=button("Загрузить файл на сервер",()->{});
        body.addView(ui.list);body.addView(ui.upload);body.addView(ui.status);
        ui.entries=new LinearLayout(this);ui.entries.setOrientation(LinearLayout.VERTICAL);body.addView(ui.entries);
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
        try{String value=ui.port.getText().toString().trim();port=value.isEmpty()?22:Integer.parseInt(value);if(host.isEmpty()||user.isEmpty()||pass.isEmpty()||port<1||port>65535)throw new IllegalArgumentException();}
        catch(Exception ex){toast("Укажите адрес, порт, имя и пароль");return null;}
        return new SftpClient.Credentials(host,port,user,pass);
    }
    private String sftpPath(SftpUi ui){String path=ui.path.getText().toString().trim();if(!path.startsWith("/")||path.indexOf('\0')>=0){toast("Укажите абсолютный путь к папке, начиная с /");return null;}return path;}
    private boolean validRemoteName(String name){return !name.isEmpty()&&!name.equals(".")&&!name.equals("..")&&!name.contains("/")&&name.indexOf('\0')<0;}
    private void sftpBusy(SftpUi ui,boolean busy){ui.busy=busy;ui.list.setEnabled(!busy);ui.upload.setEnabled(!busy);}
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
                    pendingSftp=new PendingSftp(ui,credentials,remote,SFTP_DOWNLOAD);
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
        if(interactiveSsh!=null){stopInteractiveSsh();if(shellUiReset!=null)shellUiReset.run();}
        if(mediaPlayer!=null){mediaPlayer.stopPlayback();mediaStopped=true;if(mediaController!=null)mediaController.hide();}
        super.onStop();
    }
    @Override protected void onDestroy(){stopInteractiveSsh();mediaToken=null;stopMedia();cancelScan();cancelVideo();stopWeb();if(sshTunnel!=null){sshTunnel.stop();sshTunnel=null;}super.onDestroy();}
    private void pingScreen(){ layout("Проверка сети"); note("ICMP ping: доступность зависит от сети и устройства."); EditText host=new EditText(this); host.setSingleLine(); host.setHint("Адрес или домен"); body.addView(host); TextView result=text("",15); body.addView(button("Проверить",()->{String h=host.getText().toString().trim(); if(!h.matches("[a-zA-Z0-9.:-]{1,253}") || h.startsWith("-")){result.setText("Некорректный адрес");return;} result.setText("Проверка…"); new Thread(()->{String output; try { Process p=new ProcessBuilder("ping","-c","1","-W","3",h).redirectErrorStream(true).start(); ByteArrayOutputStream b=new ByteArrayOutputStream(); try(InputStream in=p.getInputStream()){byte[] buf=new byte[1024];int n;while((n=in.read(buf))!=-1 && b.size()<8192)b.write(buf,0,n);} p.waitFor();output=b.toString("UTF-8"); }catch(Exception ex){output="Ошибка: "+ex.getMessage();} String finalOutput=output;runOnUiThread(()->result.setText(finalOutput));}).start();})); body.addView(result); body.addView(button("Назад",this::home)); }
    private void cancelVideo(){if(videoCancellation!=null){videoCancellation.cancel();videoCancellation=null;}}
    private void videoEditorScreen(){
        layout("Видео · обрезка MP4");
        note("Обрезка без перекодирования: MP4 с одной видеодорожкой H.264/H.265 и не более одной аудиодорожки AAC. Неизвестный размер и файлы больше 512 МиБ не поддерживаются. Понадобится свободное место в кэше.");
        note("Начало переносится к предыдущему ключевому кадру; конец ограничен временем кадра. Субтитры, дополнительные дорожки и метаданные могут не сохраниться. Выберите НОВЫЙ файл при сохранении — перезапись может повредить исходник. Поворот экрана отменяет операцию.");
        VideoUi ui=new VideoUi();videoUi=ui;
        ui.status=text("Выберите исходный MP4",15);ui.choose=button("Выбрать видео",()->{});body.addView(ui.choose);
        ui.start=field("Начало в миллисекундах",false);ui.start.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);ui.start.setText("0");
        ui.end=field("Конец в миллисекундах (например 10000 = 10 сек)",false);ui.end.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
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
            Uri source=ui.source;new AlertDialog.Builder(this).setTitle("Сохранить фрагмент")
                .setMessage("Выберите новое имя и не выбирайте исходный файл. Если операция записи прервётся, файл назначения может быть неполным.")
                .setNegativeButton("Отмена",null).setPositiveButton("Продолжить",(d,w)->{
                    if(videoUi!=ui)return;pendingVideo=new PendingVideo(ui,source,start,end);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/mp4");i.putExtra(Intent.EXTRA_TITLE,"trimmed.mp4");
                    try{startActivityForResult(i,VIDEO_SAVE);}catch(Exception ex){pendingVideo=null;error(ex);}
                }).show();
        });
        ui.cancel.setOnClickListener(v->{if(videoCancellation!=null)videoCancellation.cancel();ui.cancel.setEnabled(false);ui.status.setText("Отмена… Файл назначения, если запись уже началась, может быть неполным.");});
    }
    private void startVideoTrim(PendingVideo pending,Uri target){
        VideoUi ui=pending.ui;if(ui.busy)return;
        if(pending.source.equals(target)){toast("Выберите другой файл");return;}
        android.os.CancellationSignal signal=new android.os.CancellationSignal();videoCancellation=signal;ui.busy=true;ui.choose.setEnabled(false);ui.save.setEnabled(false);ui.cancel.setEnabled(true);ui.status.setText("Обработка…");
        new Thread(()->{
            VideoTrimmer.Result result=null;String failure=null;
            try{result=VideoTrimmer.trim(getContentResolver(),pending.source,target,getCacheDir(),pending.start,pending.end,signal);}
            catch(android.os.OperationCanceledException ex){failure="Отменено. Файл назначения, если запись началась, может быть неполным.";}
            catch(Exception | OutOfMemoryError ex){failure="Ошибка: "+ex.getMessage()+". Файл назначения, если запись началась, может быть неполным.";}
            VideoTrimmer.Result answer=result;String message=failure;
            runOnUiThread(()->{
                if(videoUi!=ui||isDestroyed()||isFinishing())return;if(videoCancellation==signal)videoCancellation=null;
                ui.busy=false;ui.choose.setEnabled(true);ui.save.setEnabled(ui.source!=null);ui.cancel.setEnabled(false);
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
        TextView width=text("Толщина: 8",15);body.addView(width);
        SeekBar size=new SeekBar(this);size.setMax(57);size.setProgress(5);body.addView(size);
        size.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar b,int value,boolean fromUser){view.width=value+3;width.setText("Толщина: "+(value+3));}public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}});
        LinearLayout tools=new LinearLayout(this);body.addView(tools);
        tools.addView(button("Отменить",()->{if(!view.undo())toast("Нет действия для отмены");}));
        tools.addView(button("Очистить",()->new AlertDialog.Builder(this).setMessage("Очистить холст?").setNegativeButton("Отмена",null).setPositiveButton("Очистить",(d,w)->view.clear()).show()));
        body.addView(button("Открыть картинку",()->{
            Runnable choose=()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/*");try{startActivityForResult(i,PAINT_OPEN_IMAGE);}catch(Exception ex){error(ex);}};
            if(view.revision==0)choose.run();
            else new AlertDialog.Builder(this).setMessage("Открытие картинки заменит текущий холст. Сначала сохраните его при необходимости.").setNegativeButton("Отмена",null).setPositiveButton("Продолжить",(d,w)->{if(canvas==view)choose.run();}).show();
        }));
        body.addView(button("Сохранить PNG",()->{
            Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/png");i.putExtra(Intent.EXTRA_TITLE,"drawing.png");
            try{startActivityForResult(i,SAVE_IMAGE);}catch(Exception ex){error(ex);}
        }));
        body.addView(button("Назад",this::home));
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
    private void savePaint(Uri uri,PaintView target){
        Bitmap snapshot;
        try{snapshot=target.bitmap.copy(Bitmap.Config.ARGB_8888,false);if(snapshot==null)throw new OutOfMemoryError();}
        catch(OutOfMemoryError error){toast("Недостаточно памяти для сохранения");return;}
        toast("Сохранение…");
        new Thread(()->{
            String message;
            try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){
                if(out==null||!snapshot.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("Ошибка записи");message="Рисунок сохранён";
            }catch(Exception ex){message="Ошибка сохранения; файл назначения может быть неполным: "+ex.getMessage();}
            finally{snapshot.recycle();}
            String answer=message;runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())toast(answer);});
        },"paint-save").start();
    }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();} private void error(Exception e){toast("Ошибка: "+e.getMessage());}
    @Override public void onBackPressed(){if(mediaScreen && current!=null){list();return;}if(fileScreen && current!=null && !parents.empty()){current=parents.pop();list();}else{current=null;home();}}
    static class Entry { Uri uri; String name,mime; long size; Entry(Uri u,String n,String m,long s){uri=u;name=n==null?"Без имени":n;mime=m==null?"application/octet-stream":m;size=s;} boolean dir(){return DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);} }
    static class PaintView extends View {
        private static final int SIDE=1200;
        Bitmap bitmap=Bitmap.createBitmap(SIDE,SIDE,Bitmap.Config.ARGB_8888), previous;
        Canvas drawing=new Canvas(bitmap);Paint brush=new Paint(Paint.ANTI_ALIAS_FLAG);int color=Color.BLACK,width=8;long revision;float px,py;boolean drawingStroke;
        PaintView(Context context){super(context);drawing.drawColor(Color.WHITE);setBackgroundColor(Color.LTGRAY);}
        private void checkpoint(){
            if(previous!=null){previous.recycle();previous=null;}
            try{previous=bitmap.copy(Bitmap.Config.ARGB_8888,true);}catch(OutOfMemoryError ignored){previous=null;}
        }
        void clear(){checkpoint();drawing.drawColor(Color.WHITE);revision++;invalidate();}
        boolean undo(){if(previous==null)return false;Bitmap old=bitmap;bitmap=previous;previous=null;drawing=new Canvas(bitmap);old.recycle();revision++;invalidate();return true;}
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
