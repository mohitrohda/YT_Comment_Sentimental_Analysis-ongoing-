document.addEventListener("DOMContentLoaded", async () => {
  const API_KEY = '';
  const API_URL = 'http://localhost:5001/';

  // DOM Elements
  const videoIdDisplay = document.getElementById('videoIdDisplay');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const loadingDiv = document.getElementById('loading');
  const overviewTab = document.getElementById('overview');
  const sentimentTab = document.getElementById('sentiment');
  const commentsTab = document.getElementById('comments');
  const insightsTab = document.getElementById('insights');
  const tabs = document.querySelectorAll('.tab');

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabContents = document.querySelectorAll('.tab-content');
      tabContents.forEach(content => content.classList.remove('active'));
      
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // Get current tab URL
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const url = tabs[0].url;
    const youtubeRegex = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})/;
    const match = url.match(youtubeRegex);

    if (match && match[1]) {
      const videoId = match[1];
      videoIdDisplay.textContent = videoId;
      
      await analyzeComments(videoId);
    } else {
      showError("This is not a valid YouTube video URL.");
    }
  });

  async function analyzeComments(videoId) {
    try {
      updateProgress(10, "Starting analysis...");
      
      // Fetch comments
      const comments = await fetchComments(videoId);
      if (comments.length === 0) {
        showError("No comments found for this video.");
        return;
      }
      
      updateProgress(40, `Fetched ${comments.length} comments`);
      
      // Get sentiment predictions
      const predictions = await getSentimentPredictions(comments);
      if (!predictions) {
        showError("Failed to analyze sentiment.");
        return;
      }
      
      updateProgress(70, "Processing insights...");
      
      // Process data
      const analysis = processData(comments, predictions);
      
      updateProgress(100, "Analysis complete!");
      
      // Hide loading and display results
      setTimeout(() => {
        loadingDiv.style.display = 'none';
        displayResults(analysis);
      }, 500);
      
    } catch (error) {
      console.error("Analysis error:", error);
      showError("An error occurred during analysis.");
    }
  }

  async function fetchComments(videoId) {
    let comments = [];
    let pageToken = "";
    let fetched = 0;
    
    try {
      while (comments.length < 500) {
        updateProgress(10 + (fetched / 500 * 30), `Fetching comments... (${comments.length}/500)`);
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&pageToken=${pageToken}&key=${API_KEY}`
        );
        const data = await response.json();
        
        if (data.items) {
          data.items.forEach(item => {
            const snippet = item.snippet.topLevelComment.snippet;
            comments.push({
              text: snippet.textOriginal,
              timestamp: snippet.publishedAt,
              authorId: snippet.authorChannelId?.value || 'Unknown',
              likes: snippet.likeCount,
              author: snippet.authorDisplayName
            });
          });
        }
        
        pageToken = data.nextPageToken;
        if (!pageToken) break;
        fetched += data.items?.length || 0;
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
    }
    return comments;
  }

  async function getSentimentPredictions(comments) {
    try {
      const response = await fetch(`${API_URL}/predict_with_timestamps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments })
      });
      return await response.json();
    } catch (error) {
      console.error("Error getting predictions:", error);
      return null;
    }
  }

  function processData(comments, predictions) {
    // Sentiment counts
    const sentimentCounts = { "1": 0, "0": 0, "-1": 0 };
    const sentimentData = [];
    const engagementData = [];
    
    predictions.forEach((item, index) => {
      const comment = comments[index];
      sentimentCounts[item.sentiment]++;
      sentimentData.push({
        timestamp: new Date(item.timestamp),
        sentiment: parseInt(item.sentiment),
        comment: item.comment
      });
      engagementData.push({
        time: new Date(comment.timestamp),
        likes: comment.likes || 0
      });
    });
    
    // Calculate metrics
    const totalComments = comments.length;
    const uniqueCommenters = new Set(comments.map(c => c.authorId)).size;
    const totalWords = comments.reduce((sum, comment) => 
      sum + comment.text.split(/\s+/).filter(word => word.length > 0).length, 0);
    const avgWordsPerComment = (totalWords / totalComments).toFixed(1);
    
    // Sentiment percentages
    const positivePercent = ((sentimentCounts["1"] / totalComments) * 100).toFixed(1);
    const neutralPercent = ((sentimentCounts["0"] / totalComments) * 100).toFixed(1);
    const negativePercent = ((sentimentCounts["-1"] / totalComments) * 100).toFixed(1);
    
    // Engagement metrics
    const totalLikes = comments.reduce((sum, comment) => sum + (comment.likes || 0), 0);
    const avgLikesPerComment = (totalLikes / totalComments).toFixed(1);
    
    // Time analysis
    const hours = sentimentData.map(d => d.timestamp.getHours());
    const peakHour = getPeakHour(hours);
    
    // Top contributors
    const authorCounts = comments.reduce((acc, comment) => {
      acc[comment.author] = (acc[comment.author] || 0) + 1;
      return acc;
    }, {});
    const topContributor = Object.entries(authorCounts)
      .sort((a, b) => b[1] - a[1])[0] || ['None', 0];
    
    return {
      totalComments,
      uniqueCommenters,
      avgWordsPerComment,
      positivePercent,
      neutralPercent,
      negativePercent,
      sentimentCounts,
      sentimentData,
      engagementData,
      totalLikes,
      avgLikesPerComment,
      peakHour,
      topContributor,
      comments: comments.slice(0, 25).map((comment, i) => ({
        ...comment,
        sentiment: predictions[i]?.sentiment
      })),
      wordFrequencies: getWordFrequencies(comments.map(c => c.text))
    };
  }

  function displayResults(analysis) {
    // Update overview tab
    overviewTab.innerHTML = `
      <div class="section">
        <div class="section-title">Engagement Overview</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">💬</div>
            <div class="stat-value">${analysis.totalComments}</div>
            <div class="stat-label">Total Comments</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">👥</div>
            <div class="stat-value">${analysis.uniqueCommenters}</div>
            <div class="stat-label">Unique Users</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📈</div>
            <div class="stat-value">${analysis.positivePercent}%</div>
            <div class="stat-label">Positive</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-value">${analysis.avgWordsPerComment}</div>
            <div class="stat-label">Avg. Words</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">❤️</div>
            <div class="stat-value">${analysis.totalLikes}</div>
            <div class="stat-label">Total Likes</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">👑</div>
            <div class="stat-value">${analysis.topContributor[0].substring(0, 8)}</div>
            <div class="stat-label">Top Contributor</div>
          </div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">Sentiment Distribution</div>
        <div class="sentiment-bars">
          <div class="sentiment-bar positive" style="flex: ${analysis.positivePercent}">
            ${analysis.positivePercent}%
          </div>
          <div class="sentiment-bar neutral" style="flex: ${analysis.neutralPercent}">
            ${analysis.neutralPercent}%
          </div>
          <div class="sentiment-bar negative" style="flex: ${analysis.negativePercent}">
            ${analysis.negativePercent}%
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 5px;">
          <span>😊 Positive</span>
          <span>😐 Neutral</span>
          <span>😟 Negative</span>
        </div>
      </div>
    `;
    
    // Update sentiment tab
    sentimentTab.innerHTML = `
      <div class="section">
        <div class="section-title">Detailed Sentiment Analysis</div>
        <div class="sentiment-score">
          <div class="score-value">${analysis.positivePercent}</div>
        </div>
        <div style="text-align: center; margin-bottom: 20px;">
          Overall Positive Score
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
          <div style="text-align: center;">
            <div style="font-size: 28px; font-weight: bold; color: #00b09b;">${analysis.sentimentCounts["1"]}</div>
            <div style="font-size: 12px; color: #aaa;">Positive</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 28px; font-weight: bold; color: #ffd89b;">${analysis.sentimentCounts["0"]}</div>
            <div style="font-size: 12px; color: #aaa;">Neutral</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 28px; font-weight: bold; color: #ff416c;">${analysis.sentimentCounts["-1"]}</div>
            <div style="font-size: 12px; color: #aaa;">Negative</div>
          </div>
        </div>
        
        <div id="sentiment-chart-container" class="image-container">
          <!-- Chart will be loaded here -->
        </div>
      </div>
    `;
    
    // Update comments tab
    commentsTab.innerHTML = `
      <div class="section">
        <div class="section-title">Top Comments Analysis</div>
        <div class="comments-container">
          ${analysis.comments.map((comment, index) => `
            <div class="comment-item">
              <div class="comment-text">${comment.text.substring(0, 150)}${comment.text.length > 150 ? '...' : ''}</div>
              <div class="comment-meta">
                <span>👤 ${comment.author || 'Anonymous'}</span>
                <span>❤️ ${comment.likes || 0}</span>
                <span class="sentiment-badge ${getSentimentClass(comment.sentiment)}">
                  ${getSentimentLabel(comment.sentiment)}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    // Update insights tab
    insightsTab.innerHTML = `
      <div class="section">
        <div class="section-title">Key Insights</div>
        <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div style="color: #00ccff; font-weight: bold; margin-bottom: 10px;">📈 Engagement Pattern</div>
          <div>Peak commenting hour: ${analysis.peakHour}:00</div>
          <div>Average likes per comment: ${analysis.avgLikesPerComment}</div>
          <div>Comment-to-user ratio: ${(analysis.totalComments / analysis.uniqueCommenters).toFixed(1)}</div>
        </div>
        
        <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div style="color: #00ccff; font-weight: bold; margin-bottom: 10px;">🎯 Top Contributor</div>
          <div>${analysis.topContributor[0]}: ${analysis.topContributor[1]} comments</div>
        </div>
        
        <div id="wordcloud-container" class="image-container">
          <!-- Word cloud will be loaded here -->
        </div>
        
        <div id="trend-graph-container" class="image-container">
          <!-- Trend graph will be loaded here -->
        </div>
      </div>
    `;
    
    // Load visualizations asynchronously
    loadVisualizations(analysis);
  }

  function loadVisualizations(analysis) {
    // Load sentiment chart
    fetch(`${API_URL}/generate_chart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentiment_counts: analysis.sentimentCounts })
    })
    .then(response => response.blob())
    .then(blob => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      document.getElementById('sentiment-chart-container').appendChild(img);
    });
    
    // Load word cloud
    fetch(`${API_URL}/generate_wordcloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: analysis.comments.map(c => c.text) })
    })
    .then(response => response.blob())
    .then(blob => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      document.getElementById('wordcloud-container').appendChild(img);
    });
    
    // Load trend graph
    fetch(`${API_URL}/generate_trend_graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentiment_data: analysis.sentimentData })
    })
    .then(response => response.blob())
    .then(blob => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      document.getElementById('trend-graph-container').appendChild(img);
    });
  }

  // Helper functions
  function updateProgress(percent, message) {
    progressBar.style.width = `${percent}%`;
    progressText.textContent = message;
  }

  function showError(message) {
    loadingDiv.innerHTML = `
      <div class="error">
        <div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>
        <div>${message}</div>
      </div>
    `;
  }

  function getPeakHour(hours) {
    const hourCounts = hours.reduce((acc, hour) => {
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
  }

  function getWordFrequencies(texts) {
    const words = texts.join(' ').toLowerCase().split(/\s+/);
    const frequencies = {};
    words.forEach(word => {
      if (word.length > 3) {
        frequencies[word] = (frequencies[word] || 0) + 1;
      }
    });
    return frequencies;
  }

  function getSentimentClass(sentiment) {
    switch(sentiment) {
      case "1": return "sentiment-positive";
      case "0": return "sentiment-neutral";
      case "-1": return "sentiment-negative";
      default: return "";
    }
  }

  function getSentimentLabel(sentiment) {
    switch(sentiment) {
      case "1": return "Positive";
      case "0": return "Neutral";
      case "-1": return "Negative";
      default: return "Unknown";
    }
  }
});