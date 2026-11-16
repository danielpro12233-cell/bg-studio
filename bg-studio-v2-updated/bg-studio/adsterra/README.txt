ADSTERRA FOLDER - paste your ad codes here
===========================================

Each file is for ONE ad unit. Open the file on GitHub, click the pencil (Edit), delete nothing,
paste the code Adsterra gave you (GET CODE) BELOW the lines that start with #, then Commit.
Render redeploys by itself and the ad appears on the site. An empty file = that ad is simply off.

  smartlink.txt        Smartlink_1      shown as a "Sponsored" button in the Support box
  banner-728x90.txt    728x90           top of the page (desktop)
  banner-320x50.txt    320x50           top of the page (phones)
  banner-300x250.txt   300x250          sidebar next to the tool
  banner-468x60.txt    468x60           middle of the page, between the text sections
  native-banner.txt    NativeBanner_1   below the tool
  social-bar.txt       SocialBar_1      floating bar added by Adsterra
  popunder.txt         Popunder_1       opens a new tab on a click (optional, can annoy visitors)
  banner-160x300.txt / banner-160x600.txt   supported, but not placed in the layout by default
  ads.txt              optional ads.txt line from your Adsterra dashboard

Safety: the server only accepts https links and hex keys from these files and never pastes the raw
text into a page. Banner and native ads run in a sandboxed frame. Social Bar and Popunder must run
in the page itself, so enabling them widens the site's Content-Security-Policy (see README).
