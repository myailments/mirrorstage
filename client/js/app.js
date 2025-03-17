// Basic client application
document.addEventListener('DOMContentLoaded', () => {
  const serverStatus = document.getElementById('serverStatus');
  
  // Check server health
  fetch('/health')
    .then(response => {
      if (!response.ok) {
        throw new Error('Server not responding');
      }
      return response.json();
    })
    .then(data => {
      serverStatus.textContent = `Connected (${new Date(data.timestamp).toLocaleTimeString()})`;
      serverStatus.style.color = 'green';
    })
    .catch(error => {
      serverStatus.textContent = 'Disconnected';
      serverStatus.style.color = 'red';
      console.error('Error:', error);
    });
});
