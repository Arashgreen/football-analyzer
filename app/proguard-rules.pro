# Keep the JS bridge methods (accessed via reflection from WebView)
-keepclassmembers class com.hoosha.footballanalyzer.MainActivity$AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
