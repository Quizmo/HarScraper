# Har Scraper
Scrapes and download the content from websites though HAR.

To use Run the HarScraper.exe under bin\Release\net6.0.

It will ask to insert the url you want to scrape, first time running it will download Chromium to the bin folder.

After inserting the url a new Chrome incognito window will popup with the website, you are able to click around and use the site. All network activity in the mean time will be recored and saved in the Input folder under input.har.

When done press any key to continue, the program will then read though the recored file, and download all content that was used and place it under the output folder.
