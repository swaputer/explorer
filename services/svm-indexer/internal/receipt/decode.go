package receipt

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

const (
	receiptVersion        = 1
	receiptFlags          = 0
	maxReceiptRecords     = 64
	maxRecordTopics       = 4
	maxRecordDataBytes    = 4096
	maxReceiptPayloadSize = 65536
	kernelEmitterHex      = "0xff00000000000000000000000000000000000000000000000000000000000001"
	worldExecutionHex     = "0x3112cedead241c6530b184adc877ddaf0a4157aa13a4a0988b4bde6ce794defc"
	deployedHex           = "0x80a1f0b8838c2c604364e05a5ccc199e116f9521077e9f00836dc0b340ac1531"
)

var (
	kernelEmitter       = common.HexToHash(kernelEmitterHex)
	worldExecutionTopic = common.HexToHash(worldExecutionHex)
	deployedTopic       = common.HexToHash(deployedHex)
)

func Decode(payload []byte) (Receipt, error) {
	if len(payload) > maxReceiptPayloadSize {
		return Receipt{}, fmt.Errorf("receipt payload exceeds %d bytes", maxReceiptPayloadSize)
	}
	if len(payload) < 4 {
		return Receipt{}, errors.New("receipt header is truncated")
	}
	if payload[0] != receiptVersion {
		return Receipt{}, fmt.Errorf("unsupported receipt version %d", payload[0])
	}
	if payload[1] != receiptFlags {
		return Receipt{}, fmt.Errorf("unsupported receipt flags %d", payload[1])
	}
	recordCount := int(binary.BigEndian.Uint16(payload[2:4]))
	if recordCount == 0 || recordCount > maxReceiptRecords {
		return Receipt{}, fmt.Errorf("invalid receipt record count %d", recordCount)
	}

	records := make([]Record, 0, recordCount)
	cursor := 4
	for index := 0; index < recordCount; index++ {
		record, next, err := decodeRecord(payload, cursor)
		if err != nil {
			return Receipt{}, fmt.Errorf("record %d: %w", index, err)
		}
		records = append(records, record)
		cursor = next
	}
	if cursor != len(payload) {
		return Receipt{}, fmt.Errorf("receipt has %d trailing bytes", len(payload)-cursor)
	}

	worldCount := 0
	var summary WorldExecution
	for _, record := range records {
		if record.Kind == WorldExecutionRecord {
			worldCount++
			summary = *record.WorldExecution
		}
	}
	if worldCount != 1 {
		return Receipt{}, fmt.Errorf("receipt must contain one world execution record, got %d", worldCount)
	}
	if records[len(records)-1].Kind != WorldExecutionRecord {
		return Receipt{}, errors.New("world execution record must be final")
	}
	return Receipt{Version: receiptVersion, Flags: receiptFlags, Records: records, WorldExecution: summary}, nil
}

func decodeRecord(payload []byte, start int) (Record, int, error) {
	if start < 0 || start+4 > len(payload) {
		return Record{}, start, errors.New("record length is truncated")
	}
	length := int(binary.BigEndian.Uint32(payload[start : start+4]))
	bodyStart := start + 4
	recordEnd := bodyStart + length
	if recordEnd < bodyStart || recordEnd > len(payload) {
		return Record{}, start, errors.New("record body is truncated")
	}
	cursor := bodyStart
	if cursor+32 > recordEnd {
		return Record{}, start, errors.New("emitter is truncated")
	}
	emitter := common.BytesToHash(payload[cursor : cursor+32])
	cursor += 32
	if cursor+1 > recordEnd {
		return Record{}, start, errors.New("topic count is truncated")
	}
	topicCount := int(payload[cursor])
	cursor++
	if topicCount > maxRecordTopics {
		return Record{}, start, fmt.Errorf("topic count %d exceeds %d", topicCount, maxRecordTopics)
	}
	if cursor+topicCount*32 > recordEnd {
		return Record{}, start, errors.New("topics are truncated")
	}
	topics := make([]common.Hash, topicCount)
	for index := range topicCount {
		topics[index] = common.BytesToHash(payload[cursor : cursor+32])
		cursor += 32
	}
	if cursor+4 > recordEnd {
		return Record{}, start, errors.New("data length is truncated")
	}
	dataLength := int(binary.BigEndian.Uint32(payload[cursor : cursor+4]))
	cursor += 4
	if dataLength > maxRecordDataBytes {
		return Record{}, start, fmt.Errorf("data length %d exceeds %d", dataLength, maxRecordDataBytes)
	}
	expectedLength := 32 + 1 + topicCount*32 + 4 + dataLength
	if length != expectedLength {
		return Record{}, start, fmt.Errorf("record length %d does not match %d", length, expectedLength)
	}
	if cursor+dataLength != recordEnd {
		return Record{}, start, errors.New("record data is truncated")
	}
	data := bytes.Clone(payload[cursor:recordEnd])
	record := Record{Length: uint32(length), Emitter: emitter, Topics: topics, Data: data, Kind: ApplicationRecord}
	if err := classify(&record); err != nil {
		return Record{}, start, err
	}
	return record, recordEnd, nil
}

func classify(record *Record) error {
	var first common.Hash
	if len(record.Topics) > 0 {
		first = record.Topics[0]
	}
	knownKernelSelector := first == worldExecutionTopic || first == deployedTopic
	if knownKernelSelector && record.Emitter != kernelEmitter {
		return errors.New("kernel selector was emitted by an application contract")
	}
	if record.Emitter != kernelEmitter {
		return nil
	}
	if len(record.Topics) != 1 {
		return fmt.Errorf("kernel record has %d topics", len(record.Topics))
	}
	switch first {
	case worldExecutionTopic:
		if len(record.Data) != 192 {
			return fmt.Errorf("world execution data is %d bytes", len(record.Data))
		}
		for _, value := range record.Data[64:92] {
			if value != 0 {
				return errors.New("executed byte count is not canonically encoded")
			}
		}
		decoded := &WorldExecution{
			Actor:         common.BytesToHash(record.Data[0:32]),
			RootTarget:    common.BytesToHash(record.Data[32:64]),
			ExecutedBytes: binary.BigEndian.Uint32(record.Data[92:96]),
			TokenBurned:   new(big.Int).SetBytes(record.Data[96:128]),
			GrossTokenOut: new(big.Int).SetBytes(record.Data[128:160]),
			NetTokenOut:   new(big.Int).SetBytes(record.Data[160:192]),
		}
		record.Kind = WorldExecutionRecord
		record.WorldExecution = decoded
		return nil
	case deployedTopic:
		if len(record.Data) != 96 {
			return fmt.Errorf("deployment data is %d bytes", len(record.Data))
		}
		record.Kind = MiniContractDeployedRecord
		record.Deployment = &Deployment{
			ContractID: common.BytesToHash(record.Data[0:32]),
			Creator:    common.BytesToHash(record.Data[32:64]),
			CodeHash:   common.BytesToHash(record.Data[64:96]),
		}
		return nil
	default:
		return errors.New("unknown kernel record selector")
	}
}
