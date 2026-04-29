package service

import (
	"testing"

	"clawbench/internal/model"

	"github.com/stretchr/testify/assert"
)

func newTestRegistry(t *testing.T) *ProxyRegistry {
	t.Helper()
	return NewProxyRegistry(model.ProxyConfig{Enabled: true, AllowedPorts: "1024-65535"}, 0)
}

func TestProxyRegistry_RegisterPort(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	err := r.RegisterPort(8080, "test", "http")
	assert.NoError(t, err)
	assert.True(t, r.IsPortRegistered(8080))
}

func TestProxyRegistry_RegisterPort_Invalid(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	tests := []struct {
		name string
		port int
	}{
		{"zero", 0},
		{"negative", -1},
		{"too large", 70000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := r.RegisterPort(tt.port, "", "")
			assert.Error(t, err)
		})
	}
}

func TestProxyRegistry_RegisterPort_Duplicate(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	err := r.RegisterPort(3000, "first", "")
	assert.NoError(t, err)

	err = r.RegisterPort(3000, "second", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already registered")
}

func TestProxyRegistry_UnregisterPort(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	_ = r.RegisterPort(9090, "metrics", "")

	err := r.UnregisterPort(9090)
	assert.NoError(t, err)
	assert.False(t, r.IsPortRegistered(9090))
}

func TestProxyRegistry_UnregisterPort_NotRegistered(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	err := r.UnregisterPort(9999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not registered")
}

func TestProxyRegistry_ListPorts_Sorted(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	_ = r.RegisterPort(8080, "api", "")
	_ = r.RegisterPort(3000, "app", "")
	_ = r.RegisterPort(5173, "vite", "")

	ports := r.ListPorts()
	assert.Len(t, ports, 3)
	assert.Equal(t, 3000, ports[0].Port)
	assert.Equal(t, 5173, ports[1].Port)
	assert.Equal(t, 8080, ports[2].Port)
}

func TestProxyRegistry_ListPorts_Empty(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	ports := r.ListPorts()
	assert.Empty(t, ports)
}

func TestProxyRegistry_IsPortRegistered(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	assert.False(t, r.IsPortRegistered(8080))
	_ = r.RegisterPort(8080, "", "")
	assert.True(t, r.IsPortRegistered(8080))
}

func TestIsPortInRange(t *testing.T) {
	tests := []struct {
		name     string
		port     int
		rangeStr string
		expected bool
	}{
		{"in range", 3000, "1024-65535", true},
		{"below range", 80, "1024-65535", false},
		{"above range", 70000, "1024-65535", false},
		{"exact match", 8080, "3000,8080,9090", true},
		{"not in list", 4000, "3000,8080,9090", false},
		{"mixed range+single in range", 5000, "1024-5000,8080", true},
		{"mixed range+single exact", 8080, "1024-5000,8080", true},
		{"mixed range+single not match", 6000, "1024-5000,8080", false},
		{"empty range allows all", 1234, "", true},
		{"boundary low", 1024, "1024-65535", true},
		{"boundary high", 65535, "1024-65535", true},
		{"just below boundary", 1023, "1024-65535", false},
		{"just above boundary", 65536, "1024-65535", false},
		{"single port match", 3000, "3000", true},
		{"single port no match", 3001, "3000", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isPortInRange(tt.port, tt.rangeStr)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestProxyRegistry_DisabledConfig(t *testing.T) {
	r := NewProxyRegistry(model.ProxyConfig{Enabled: false}, 0)
	defer r.Stop()

	// Register should still work (no allowed_ports check when disabled, default allows all)
	err := r.RegisterPort(8080, "test", "http")
	assert.NoError(t, err)
}

func TestProxyRegistry_RegisterPort_Protocol(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	err := r.RegisterPort(4443, "secure", "https")
	assert.NoError(t, err)

	ports := r.ListPorts()
	assert.Len(t, ports, 1)
	assert.Equal(t, "https", ports[0].Protocol)

	err = r.RegisterPort(8080, "plain", "http")
	assert.NoError(t, err)

	protocol := r.GetPortProtocol(4443)
	assert.Equal(t, "https", protocol)

	protocol = r.GetPortProtocol(8080)
	assert.Equal(t, "http", protocol)

	// Unregistered port defaults to http
	protocol = r.GetPortProtocol(9999)
	assert.Equal(t, "http", protocol)
}

func TestProxyRegistry_RegisterPort_InvalidProtocolDefaultsToHTTP(t *testing.T) {
	r := newTestRegistry(t)
	defer r.Stop()

	err := r.RegisterPort(8080, "test", "ftp")
	assert.NoError(t, err)

	ports := r.ListPorts()
	assert.Equal(t, "http", ports[0].Protocol) // non-https defaults to http
}

func TestParseProcNetTCPData(t *testing.T) {
	data := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1394 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 67890 1 0000000000000000 20 0 0 10 -1
   2: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 11111 1 00000000 100 0 0 10 0
   3: 00000000:1F90 00000000:0000 06 00000000:00000000 00:00000000 00000000     0        0 22222 1 00000000 100 0 0 10 0
`
	// 0x1F90 = 8080 (LISTEN), 0x1394 = 5012 (LISTEN), 0x0050 = 80 (LISTEN)
	// Line 3 has state 06 (TIME_WAIT), should be skipped
	ports := parseProcNetTCPData(data)
	assert.Contains(t, ports, 8080)
	assert.Contains(t, ports, 5012)
	assert.Contains(t, ports, 80)
	assert.Len(t, ports, 3)
}

func TestParseProcNetTCPData_Empty(t *testing.T) {
	ports := parseProcNetTCPData("")
	assert.Nil(t, ports)
}

func TestParseProcNetTCPData_HeaderOnly(t *testing.T) {
	data := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
`
	ports := parseProcNetTCPData(data)
	assert.Empty(t, ports)
}
