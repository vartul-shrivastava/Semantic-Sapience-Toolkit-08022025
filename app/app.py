import base64
import io
import json
import logging
import re
import subprocess
import time

import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from gensim.models.coherencemodel import CoherenceModel
from gensim.corpora.dictionary import Dictionary
import numpy as np
from flask import Flask, request, jsonify, send_file, render_template
import nltk
from nltk.corpus import stopwords
import psutil
from nltk import word_tokenize
from nltk.collocations import BigramCollocationFinder
from nltk.sentiment import SentimentIntensityAnalyzer
from wordcloud import WordCloud
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import LatentDirichletAllocation, NMF, TruncatedSVD
from bertopic import BERTopic
from sentence_transformers import SentenceTransformer
from textblob import TextBlob
from transformers import pipeline, AutoTokenizer
import ollama
from tqdm import tqdm

# Download required NLTK data
nltk.download('punkt', quiet=True)
nltk.download('vader_lexicon', quiet=True)
nltk.download('stopwords', quiet=True)

app = Flask(__name__, static_folder="static", template_folder="templates")

vader_analyzer = SentimentIntensityAnalyzer()

# Cache for transformer-based sentiment analysis pipelines
loaded_pipelines = {}

def is_ollama_running():
    try:
        result = subprocess.run(
            ['ollama', 'list'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        return False

# Route to check AI readiness and available models
@app.route('/check_ai_readiness', methods=['GET'])
def check_ai_readiness():
    if not is_ollama_running():
        return jsonify({
            "ollama_ready": False,
            "models": [],
            "error": "Ollama is not running or not found in PATH."
        })
    try:
        model_data = str(ollama.list())
        pattern = r"model='(.*?)'"
        models = re.findall(pattern, model_data)
        models = [name.strip() for name in models if name.strip()]
        print("Available models:", models)
        return jsonify({
            "ollama_ready": True,
            "models": models
        })
    except Exception as e:
        return jsonify({
            "ollama_ready": True,
            "models": [],
            "error": f"Error fetching Ollama models: {e}"
        })

def get_dl_pipeline(model_name: str, max_length: int = 512):
    if model_name not in loaded_pipelines:
        try:
            tokenizer = AutoTokenizer.from_pretrained(model_name)
            loaded_pipelines[model_name] = pipeline(
                "sentiment-analysis",
                model=model_name,
                tokenizer=tokenizer,
                truncation=True,
                max_length=max_length
            )
        except Exception as e:
            raise ValueError(f"Error loading model '{model_name}': {str(e)}")
    return loaded_pipelines[model_name]

def parse_csv_from_bytes(data_bytes):
    try:
        stream = io.BytesIO(data_bytes)
        df = pd.read_csv(stream)
        stats = {}
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                stats[col] = {
                    'type': 'Numeric',
                    'mean': float(df[col].mean()),
                    'stdDev': float(df[col].std())
                }
            else:
                series_str = df[col].astype(str)
                lengths = series_str.str.len()
                stats[col] = {
                    'type': 'Textual',
                    'avgLen': float(lengths.mean()),
                    'maxLen': int(lengths.max()),
                    'minLen': int(lengths.min()),
                    'uniqueCount': int(series_str.nunique())
                }
        return df, stats
    except Exception as e:
        raise ValueError(f"Error processing CSV: {str(e)}")

def parse_xlsx_from_bytes(data_bytes):
    try:
        stream = io.BytesIO(data_bytes)
        df = pd.read_excel(stream)
        stats = {}
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                stats[col] = {
                    'type': 'Numeric',
                    'mean': float(df[col].mean()),
                    'stdDev': float(df[col].std())
                }
            else:
                series_str = df[col].astype(str)
                lengths = series_str.str.len()
                stats[col] = {
                    'type': 'Textual',
                    'avgLen': float(lengths.mean()),
                    'maxLen': int(lengths.max()),
                    'minLen': int(lengths.min()),
                    'uniqueCount': int(series_str.nunique())
                }
        return df, stats
    except Exception as e:
        raise ValueError(f"Error processing XLSX: {str(e)}")

def generate_word_cloud(word_freq, max_words=500):
    wc = WordCloud(
        width=1500,
        height=1500,
        max_words=max_words,
        background_color="white"
    ).generate_from_frequencies(word_freq)
    img_buffer = io.BytesIO()
    wc.to_image().save(img_buffer, format="PNG")
    img_buffer.seek(0)
    img_b64 = base64.b64encode(img_buffer.read()).decode("utf-8")
    data_uri = f"data:image/png;base64,{img_b64}"
    return data_uri

def compute_cosine_similarity(query_embedding, word_embeddings):
    if query_embedding.ndim != 2 or word_embeddings.ndim != 2:
        raise ValueError("Both query_embedding and word_embeddings must be 2D arrays.")
    similarities = cosine_similarity(query_embedding, word_embeddings)[0]
    return similarities

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part in request."}), 400
    file_obj = request.files['file']
    if file_obj.filename == '':
        return jsonify({"error": "No file selected."}), 400
    try:
        file_bytes = file_obj.read()
        filename = file_obj.filename.lower()
        if filename.endswith('.csv'):
            df, stats = parse_csv_from_bytes(file_bytes)
            return jsonify({
                "message": f"{file_obj.filename} processed successfully.",
                "stats": stats
            })
        elif filename.endswith('.xlsx'):
            df, stats = parse_xlsx_from_bytes(file_bytes)
            return jsonify({
                "message": f"{file_obj.filename} processed successfully.",
                "stats": stats
            })
        else:
            return jsonify({
                "message": f"{file_obj.filename} received. Only CSV and XLSX processing implemented."
            }), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/exportProject', methods=['POST'])
def export_project():
    try:
        config = request.get_json()
        if config is None:
            return jsonify({"error": "No JSON payload provided."}), 400
        config_json = json.dumps(config, indent=2)
        buffer = io.BytesIO()
        buffer.write(config_json.encode('utf-8'))
        buffer.seek(0)
        return send_file(
            buffer,
            as_attachment=True,
            download_name="Semantic_Sapience_Project.ssproj",
            mimetype="application/json"
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/importProject', methods=['POST'])
def import_project():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided."}), 400
    file_obj = request.files['file']
    try:
        file_content = file_obj.read().decode('utf-8')
        config = json.loads(file_content)
        return jsonify({"message": "Project imported successfully.", "config": config}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/process/topic_modeling', methods=['POST'])
def process_topic_modeling():
    params = request.get_json()
    if not params:
        return jsonify({"error": "No JSON payload"}), 400

    method = params.get("method", "lda").lower()
    csv_b64 = params.get("base64")
    file_type = params.get("fileType", "csv").lower()
    column = params.get("column")
    num_topics = int(params.get("numTopics", 5))
    remove_sw = params.get("stopwords", False)
    words_per_topic = int(params.get("wordsPerTopic", 5))
    embedding_model_name = params.get("embeddingModel", "")
    random_state = int(params.get("randomState", 42))
    coherence_analysis = params.get("coherence_analysis", False)

    if not csv_b64 or not column:
        missing = [param for param in ["base64", "column"] if not params.get(param)]
        return jsonify({"error": f"Must provide {', '.join(missing)}."}), 400

    try:
        file_bytes = base64.b64decode(csv_b64)
        if file_type == "xlsx":
            df, _ = parse_xlsx_from_bytes(file_bytes)
        elif file_type == "csv":
            df, _ = parse_csv_from_bytes(file_bytes)
        else:
            return jsonify({"error": f"Unsupported file type '{file_type}'."}), 400
    except Exception as e:
        return jsonify({"error": f"Error decoding file: {str(e)}"}), 400

    if column not in df.columns:
        return jsonify({"error": f"Column '{column}' not found in dataset."}), 400

    texts = df[column].astype(str).dropna().tolist()
    if not texts:
        return jsonify({"error": "No valid rows in dataset."}), 400

    user_stops = set(stopwords.words("english")) if remove_sw else set()
    topic_labels = []

    try:
        if method == "lda":
            vectorizer = CountVectorizer(
                stop_words=list(user_stops) if remove_sw else None,
                token_pattern=r"(?u)\b\w+\b"
            )
            X = vectorizer.fit_transform(texts)
            vocab = vectorizer.get_feature_names_out()
            lda_model = LatentDirichletAllocation(n_components=num_topics, random_state=random_state)
            lda_model.fit(X)
            for comp in lda_model.components_:
                top_indices = comp.argsort()[::-1][:words_per_topic]
                top_words = [vocab[i] for i in top_indices]
                topic_labels.append(f": {', '.join(top_words)}")
        elif method == "nmf":
            vectorizer = TfidfVectorizer(
                stop_words=list(user_stops) if remove_sw else None,
                token_pattern=r"(?u)\b\w+\b"
            )
            X = vectorizer.fit_transform(texts)
            vocab = vectorizer.get_feature_names_out()
            nmf_model = NMF(n_components=num_topics, random_state=random_state)
            nmf_model.fit(X)
            for comp in nmf_model.components_:
                top_indices = comp.argsort()[::-1][:words_per_topic]
                top_words = [vocab[i] for i in top_indices]
                topic_labels.append(f": {', '.join(top_words)}")
        elif method == "lsa":
            vectorizer = TfidfVectorizer(
                stop_words=list(user_stops) if remove_sw else None,
                token_pattern=r"(?u)\b\w+\b"
            )
            X = vectorizer.fit_transform(texts)
            vocab = vectorizer.get_feature_names_out()
            svd_model = TruncatedSVD(n_components=num_topics, random_state=random_state)
            svd_model.fit(X)
            for row in svd_model.components_:
                top_indices = row.argsort()[::-1][:words_per_topic]
                top_words = [vocab[i] for i in top_indices]
                topic_labels.append(f": {', '.join(top_words)}")
        elif method == "bertopic":
            if not embedding_model_name.strip():
                embedding_model_name = "all-MiniLM-L6-v2"
            embedding_model = SentenceTransformer(embedding_model_name)
            embeddings = embedding_model.encode(texts, show_progress_bar=False)
            topic_model = BERTopic(verbose=False, nr_topics=num_topics)
            topics_result, _ = topic_model.fit_transform(texts, embeddings)
            unique_topics = sorted(set(topics_result) - {-1})
            for t_id in unique_topics:
                top_words_tuples = topic_model.get_topic(t_id)
                top_words = [pair[0] for pair in top_words_tuples[:words_per_topic]]
                topic_labels.append(f": {', '.join(top_words)}")
        else:
            return jsonify({"error": f"Unsupported method '{method}'."}), 400

        if coherence_analysis and method in ["lda", "nmf", "lsa"]:
            min_topics = int(params.get("min_topics", 2))
            max_topics = int(params.get("max_topics", num_topics))
            step = int(params.get("step", 1))
            coherence_scores = []
            topics_range = list(range(min_topics, max_topics + 1, step))
            tokenized_texts = [nltk.word_tokenize(text.lower()) for text in texts]
            dictionary = Dictionary(tokenized_texts)
            corpus = [dictionary.doc2bow(text) for text in tokenized_texts]
            for k in tqdm(topics_range, desc="Coherence analysis", unit="topic"):
                if method == "lda":
                    vectorizer = CountVectorizer(
                        stop_words=list(user_stops) if remove_sw else None,
                        token_pattern=r"(?u)\b\w+\b"
                    )
                    X = vectorizer.fit_transform(texts)
                    vocab = vectorizer.get_feature_names_out()
                    model_k = LatentDirichletAllocation(n_components=k, random_state=random_state)
                    model_k.fit(X)
                    topics = []
                    for comp in model_k.components_:
                        top_indices = comp.argsort()[::-1][:words_per_topic]
                        top_words = [vocab[i] for i in top_indices]
                        topics.append(top_words)
                elif method == "nmf":
                    vectorizer = TfidfVectorizer(
                        stop_words=list(user_stops) if remove_sw else None,
                        token_pattern=r"(?u)\b\w+\b"
                    )
                    X = vectorizer.fit_transform(texts)
                    vocab = vectorizer.get_feature_names_out()
                    model_k = NMF(n_components=k, random_state=random_state)
                    model_k.fit(X)
                    topics = []
                    for comp in model_k.components_:
                        top_indices = comp.argsort()[::-1][:words_per_topic]
                        top_words = [vocab[i] for i in top_indices]
                        topics.append(top_words)
                elif method == "lsa":
                    vectorizer = TfidfVectorizer(
                        stop_words=list(user_stops) if remove_sw else None,
                        token_pattern=r"(?u)\b\w+\b"
                    )
                    X = vectorizer.fit_transform(texts)
                    vocab = vectorizer.get_feature_names_out()
                    model_k = TruncatedSVD(n_components=k, random_state=random_state)
                    model_k.fit(X)
                    topics = []
                    for row in model_k.components_:
                        top_indices = row.argsort()[::-1][:words_per_topic]
                        top_words = [vocab[i] for i in top_indices]
                        topics.append(top_words)
                coherence_model = CoherenceModel(topics=topics, texts=tokenized_texts,
                                                  dictionary=dictionary, coherence='c_v')
                score = coherence_model.get_coherence()
                coherence_scores.append(score)
            best_index = np.argmax(coherence_scores)
            best_topic_num = topics_range[best_index]
            best_coherence = coherence_scores[best_index]
            plt.figure(figsize=(8, 6))
            plt.plot(topics_range, coherence_scores, marker='o')
            plt.xlabel("Number of Topics")
            plt.ylabel("Coherence Score (c_v)")
            plt.title(f"Coherence Analysis for {method.upper()}")
            plt.grid(True)
            buf = io.BytesIO()
            plt.savefig(buf, format='png')
            plt.close()
            buf.seek(0)
            img_b64 = base64.b64encode(buf.read()).decode("utf-8")
            coherence_plot = f"data:image/png;base64,{img_b64}"
            return jsonify({
                "message": f"{method.upper()} topic modeling completed with coherence analysis.",
                "topics": topic_labels,
                "coherence_analysis": {
                    "coherence_plot": coherence_plot,
                    "best_topic": best_topic_num,
                    "best_coherence": best_coherence,
                    "topics_range": topics_range,
                    "coherence_scores": coherence_scores
                }
            }), 200

        return jsonify({
            "message": f"{method.upper()} topic modeling completed.",
            "topics": topic_labels
        }), 200

    except Exception as e:
        return jsonify({"error": f"Error during topic modeling: {str(e)}"}), 500

@app.route('/get_models', methods=['GET'])
def get_models():
    try:
        model_data = ollama.list()
        pattern = r"model='(.*?)'"
        models = re.findall(pattern, str(model_data))
        models = [name.strip() for name in models if name.strip()]
        return jsonify({"success": True, "models": models})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/process/sentiment', methods=['POST'])
def process_sentiment():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON payload."}), 400

        method = data.get("method")
        column = data.get("column")
        b64_csv = data.get("base64")

        if not all([method, column, b64_csv]):
            missing = [param for param in ["method", "column", "base64"] if not data.get(param)]
            return jsonify({"error": f"Missing required parameters: {', '.join(missing)}"}), 400

        if method not in ["rulebasedsa", "dlbasedsa"]:
            return jsonify({"error": f"Unknown method '{method}'"}), 400

        rule_based_model = data.get("ruleBasedModel", "textblob")
        dl_model_name = data.get("dlModel", "distilbert-base-uncased-finetuned-sst-2-english")

        try:
            csv_bytes = base64.b64decode(b64_csv)
            df, _ = parse_csv_from_bytes(csv_bytes)
        except Exception as e:
            return jsonify({"error": f"Error decoding CSV data: {str(e)}"}), 400

        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found in dataset."}), 400

        df_clean = df[df[column].astype(str).str.strip() != ""]
        texts = df_clean[column].astype(str).tolist()
        if not texts:
            return jsonify({"error": "No valid rows in dataset after cleaning."}), 400

        results = []
        if method == "rulebasedsa":
            if rule_based_model == "textblob":
                for text in tqdm(texts, desc="Processing rule-based sentiment", unit="text"):
                    polarity = TextBlob(text).sentiment.polarity
                    sentiment_label = ("Positive" if polarity > 0 else "Negative" if polarity < 0 else "Neutral")
                    results.append({
                        "text": text,
                        "sentiment": sentiment_label,
                        "score": polarity
                    })
            elif rule_based_model == "vader":
                for text in tqdm(texts, desc="Processing rule-based sentiment (Vader)", unit="text"):
                    scores = vader_analyzer.polarity_scores(text)
                    compound = scores["compound"]
                    if compound >= 0.05:
                        sentiment_label = "Positive"
                    elif compound <= -0.05:
                        sentiment_label = "Negative"
                    else:
                        sentiment_label = "Neutral"
                    results.append({
                        "text": text,
                        "sentiment": sentiment_label,
                        "score": compound
                    })
            else:
                return jsonify({"error": f"Unsupported rule-based model '{rule_based_model}'"}), 400
        elif method == "dlbasedsa":
            try:
                dl_pipe = get_dl_pipeline(dl_model_name)
            except ValueError as ve:
                return jsonify({"error": str(ve)}), 400
            try:
                dl_results = dl_pipe(texts)
                for text_val, res in zip(tqdm(texts, desc="Processing DL-based sentiment", unit="text"), dl_results):
                    label = res.get("label", "Neutral")
                    score = res.get("score", 0.0)
                    if label.upper() in ['POSITIVE', 'NEGATIVE']:
                        sentiment_label = label.capitalize()
                    else:
                        sentiment_label = 'Neutral'
                    results.append({
                        "text": text_val,
                        "sentiment": sentiment_label,
                        "score": float(score)
                    })
            except Exception as e:
                return jsonify({"error": f"Error during DL-based sentiment analysis: {str(e)}"}), 500

        summary = {
            "Positive": {"Count": 0, "Average Score": 0.0},
            "Neutral":  {"Count": 0, "Average Score": 0.0},
            "Negative": {"Count": 0, "Average Score": 0.0}
        }
        for r in results:
            s = r["sentiment"]
            try:
                score = float(r["score"])
            except Exception:
                score = 0.0
            if s in summary:
                summary[s]["Count"] += 1
                summary[s]["Average Score"] += score

        for sentiment, data_stats in summary.items():
            count = data_stats["Count"]
            avg = round(data_stats["Average Score"] / count, 4) if count > 0 else None
            summary[sentiment]["Average Score"] = avg

        total_count = summary["Positive"]["Count"] + summary["Neutral"]["Count"] + summary["Negative"]["Count"]
        if total_count > 0:
            percentages = {
                "Positive": summary["Positive"]["Count"] * 100 / total_count,
                "Neutral": summary["Neutral"]["Count"] * 100 / total_count,
                "Negative": summary["Negative"]["Count"] * 100 / total_count
            }
        else:
            percentages = {"Positive": 0, "Neutral": 0, "Negative": 0}

        plt.figure(figsize=(6, 4))
        sentiments_list = list(percentages.keys())
        percents_list = list(percentages.values())
        bars = plt.bar(sentiments_list, percents_list, color=["green", "blue", "red"])
        plt.xlabel("Sentiment")
        plt.ylabel("Percentage")
        plt.title("Sentiment Analysis Summary")
        for bar in bars:
            yval = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2.0, yval, f'{yval:.1f}%', va='bottom', ha='center')
        buf = io.BytesIO()
        plt.savefig(buf, format='png')
        plt.close()
        buf.seek(0)
        chart_b64 = base64.b64encode(buf.read()).decode("utf-8")
        chart_data_uri = f"data:image/png;base64,{chart_b64}"

        return jsonify({
            "message": "Sentiment analysis completed (aggregated).",
            "stats": summary,
            "chart": chart_data_uri
        }), 200

    except Exception as ex:
        return jsonify({"error": "Internal Server Error."}), 500

@app.route("/process/wordcloud", methods=["POST"])
def process_wordcloud():
    params = request.get_json()
    if not params:
        return jsonify({"error": "Missing JSON payload."}), 400
    method = params.get("method", "freq").lower()
    csv_b64 = params.get("base64")
    column = params.get("column")
    file_type = params.get("fileType", "csv").lower()
    stopwords_flag = params.get("stopwords", False)
    exclude_words_list = params.get("excludeWords", [])
    max_words = params.get("maxWords", 500)
    window_size = params.get("windowSize", 2)
    if not csv_b64 or not column:
        return jsonify({"error": "Must provide 'base64' data and 'column'."}), 400
    if not isinstance(exclude_words_list, list):
        exclude_words_list = []
    try:
        csv_bytes = base64.b64decode(csv_b64)
        if file_type == "xlsx":
            df, _ = parse_xlsx_from_bytes(csv_bytes)
        elif file_type == "csv":
            df, _ = parse_csv_from_bytes(csv_bytes)
        else:
            return jsonify({"error": f"Unsupported file type '{file_type}'."}), 400
        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found in dataset."}), 400
        texts = df[column].astype(str).dropna().tolist()
        if len(texts) == 0:
            return jsonify({"error": f"No valid text rows in column '{column}'."}), 400
        user_stops_set = set(exclude_words_list)
        if stopwords_flag:
            user_stops_set |= set(stopwords.words("english"))
        user_stops_list = list(user_stops_set)
        word_freq = {}
        if method == "tfidf":
            vectorizer = TfidfVectorizer(
                stop_words=user_stops_list if stopwords_flag else None,
                token_pattern=r"(?u)\b\w+\b"
            )
            X = vectorizer.fit_transform(texts)
            features = vectorizer.get_feature_names_out()
            tfidf_sums = X.sum(axis=0).A1
            for token, score in zip(features, tfidf_sums):
                if token in user_stops_set:
                    continue
                word_freq[token] = float(score)
        elif method == "freq":
            vectorizer = CountVectorizer(
                stop_words=user_stops_list if stopwords_flag else None,
                token_pattern=r"(?u)\b\w+\b"
            )
            X = vectorizer.fit_transform(texts)
            features = vectorizer.get_feature_names_out()
            counts = X.sum(axis=0).A1
            for token, c in zip(features, counts):
                if token in user_stops_set:
                    continue
                word_freq[token] = int(c)
        elif method == "collocation":
            word_freq = {}
            for text in tqdm(texts, desc="Processing collocations", unit="text"):
                tokens = [t.lower() for t in word_tokenize(text) if t.isalpha()]
                if user_stops_list:
                    tokens = [t for t in tokens if t not in user_stops_list]
                finder = BigramCollocationFinder.from_words(tokens, window_size=window_size)
                freq_dict = finder.ngram_fd
                for bigram, freq in freq_dict.items():
                    bigram_str = "_".join(bigram)
                    word_freq[bigram_str] = word_freq.get(bigram_str, 0) + freq
            if len(word_freq) > max_words:
                sorted_bigrams = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
                limited_bigrams = sorted_bigrams[:max_words]
                word_freq = dict(limited_bigrams)
        else:
            return jsonify({"error": f"Unsupported method '{method}'."}), 400
        if not word_freq:
            return jsonify({"error": "No tokens found for the chosen configuration."}), 400
        data_uri = generate_word_cloud(word_freq, max_words=max_words)
        return jsonify({
            "message": f"{method.upper()} word cloud generated successfully.",
            "image": data_uri
        }), 200
    except Exception as e:
        return jsonify({"error": f"Error generating word cloud: {str(e)}"}), 500

@app.route("/process/semantic_wordcloud", methods=["POST"])
def process_semantic_wordcloud():
    print("DEBUG: Received request to generate semantic word cloud.")
    params = request.get_json()
    if not params:
        print("DEBUG: Missing JSON payload in the request.")
        return jsonify({"error": "Missing JSON payload."}), 400
    query = params.get("query")
    column = params.get("column")
    csv_b64 = params.get("base64")
    embedding_model_name = params.get("embeddingModel", "all-MiniLM-L6-v2")
    max_words = params.get("maxWords", 500)
    stopwords_flag = params.get("stopwords", False)
    print(f"DEBUG: Parameters received -> Query: {query}, Column: {column}, Embedding Model: {embedding_model_name}, Max Words: {max_words}, Stopwords Flag: {stopwords_flag}")
    if not query or not column or not csv_b64:
        print("DEBUG: Missing required inputs: query, column, or base64 CSV data.")
        return jsonify({"error": "Query, column, and base64 CSV data are required."}), 400
    try:
        print("DEBUG: Decoding base64 CSV data.")
        csv_bytes = base64.b64decode(csv_b64)
        df, _ = parse_csv_from_bytes(csv_bytes)
        print(f"DEBUG: Columns in dataset -> {list(df.columns)}")
        if column not in df.columns:
            print(f"DEBUG: Specified column '{column}' not found in dataset.")
            return jsonify({"error": f"Column '{column}' not found in dataset."}), 400
        texts = df[column].dropna().astype(str).tolist()
        print(f"DEBUG: Extracted {len(texts)} rows from column '{column}'.")
        if not texts:
            print("DEBUG: No valid rows found in the specified column.")
            return jsonify({"error": "No valid rows in the specified column."}), 400
        if not embedding_model_name.strip():
            print("DEBUG: Embedding model name is empty. Using default model 'all-MiniLM-L6-v2'.")
            embedding_model_name = "all-MiniLM-L6-v2"
        print(f"DEBUG: Initializing embedding model '{embedding_model_name}'.")
        embedding_model = SentenceTransformer(embedding_model_name)
        print("DEBUG: Computing embeddings for query and texts.")
        query_embedding = embedding_model.encode([query], show_progress_bar=False)[0]
        text_embeddings = embedding_model.encode(texts, show_progress_bar=False)
        print("DEBUG: Embedding computation completed.")
        print(f"DEBUG: Query embedding shape: {query_embedding.shape}, Text embeddings shape: {text_embeddings.shape}")
        print("DEBUG: Calculating cosine similarities.")
        query_norm = np.linalg.norm(query_embedding)
        text_norms = np.linalg.norm(text_embeddings, axis=1)
        cosine_similarities = np.dot(text_embeddings, query_embedding) / (text_norms * query_norm + 1e-10)
        print(f"DEBUG: Cosine similarities calculated. Sample values: {cosine_similarities[:5]}")
        top_indices = cosine_similarities.argsort()[-max_words:][::-1]
        selected_texts = [texts[i] for i in top_indices]
        print(f"DEBUG: Selected top {len(selected_texts)} texts based on similarity.")
        word_freq = {}
        stopwords_set = set(stopwords.words("english")) if stopwords_flag else set()
        for text in tqdm(selected_texts, desc="Processing semantic word cloud", unit="text"):
            if not text:
                print("DEBUG: Skipping empty text.")
                continue
            try:
                tokens = word_tokenize(text.lower())
                filtered_tokens = [t for t in tokens if t.isalpha() and t not in stopwords_set]
                for token in filtered_tokens:
                    word_freq[token] = word_freq.get(token, 0) + 1
            except Exception as tokenize_error:
                print(f"DEBUG: Tokenization error for text: '{text}' -> {tokenize_error}")
        print(f"DEBUG: Word frequencies generated. Sample: {list(word_freq.items())[:5]}")
        if not word_freq:
            print("DEBUG: No tokens found for the selected configuration.")
            return jsonify({"error": "No tokens found for the selected configuration."}), 400
        print("DEBUG: Generating word cloud.")
        wc = WordCloud(
            width=1500,
            height=1500,
            max_words=max_words,
            background_color="white"
        ).generate_from_frequencies(word_freq)
        print("DEBUG: Converting word cloud to base64.")
        img_buffer = io.BytesIO()
        wc.to_image().save(img_buffer, format="PNG")
        img_buffer.seek(0)
        img_b64 = base64.b64encode(img_buffer.read()).decode("utf-8")
        data_uri = f"data:image/png;base64,{img_b64}"
        print("DEBUG: Semantic word cloud generated successfully.")
        return jsonify({
            "message": "Semantic word cloud generated successfully.",
            "image": data_uri
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({"error": f"Error generating word cloud: {str(e)}"}), 500

@app.route('/process/absa', methods=['POST'])
def process_absa():
    params = request.get_json()
    if not params:
        return jsonify({"error": "No JSON payload provided."}), 400
    csv_b64 = params.get("base64")
    file_type = params.get("fileType", "csv").lower()
    column = params.get("column")
    aspect = params.get("aspect")
    model = params.get("model")
    if not all([csv_b64, column, aspect]):
        missing = [param for param in ["base64", "column", "aspect"] if not params.get(param)]
        return jsonify({"error": f"Parameters 'base64', 'column', and 'aspect' are required."}), 400
    try:
        csv_bytes = base64.b64decode(csv_b64)
        if file_type == "csv":
            df, _ = parse_csv_from_bytes(csv_bytes)
        elif file_type == "xlsx":
            df, _ = parse_xlsx_from_bytes(csv_bytes)
        else:
            return jsonify({"error": f"Unsupported file type '{file_type}'."}), 400
    except Exception as e:
        return jsonify({"error": f"Error decoding file: {str(e)}"}), 400
    if column not in df.columns:
        return jsonify({"error": f"Column '{column}' not found in dataset."}), 400
    texts = df[column].astype(str).dropna().tolist()
    if not texts:
        return jsonify({"error": "No valid text data found in the specified column."}), 400
    results = []
    try:
        for text in tqdm(texts, desc="Processing ABSA", unit="text"):
            prompt = (
                f"Analyze the sentiment towards the aspect '{aspect}' in the following text.\n\n"
                f"Text: \"{text}\"\nAspect: {aspect}\nSentiment (Positive, Negative, Neutral) DONT WRITE ANYTHING ELSE, NOT EVEN EXPLANATION, JUST SENTIMENT IN ONE WORD:"
            )
            response = ollama.chat(
                model=model,
                messages=[{'role': 'user', 'content': prompt}]
            )
            sentiment = response.message.content.strip().capitalize()
            if sentiment not in ["Positive", "Negative", "Neutral"]:
                sentiment = "Neutral"
            results.append({
                "text": text,
                "aspect": aspect,
                "sentiment": sentiment
            })
    except Exception as e:
        return jsonify({"error": f"Error during ABSA: {str(e)}"}), 500
    summary = {
        "Positive": {"Count": 0},
        "Neutral":  {"Count": 0},
        "Negative": {"Count": 0}
    }
    for r in results:
        s = r["sentiment"]
        if s in summary:
            summary[s]["Count"] += 1
    total_count = summary["Positive"]["Count"] + summary["Neutral"]["Count"] + summary["Negative"]["Count"]
    if total_count > 0:
        percentages = {
            "Positive": summary["Positive"]["Count"] * 100 / total_count,
            "Neutral":  summary["Neutral"]["Count"] * 100 / total_count,
            "Negative": summary["Negative"]["Count"] * 100 / total_count
        }
    else:
        percentages = {"Positive": 0, "Neutral": 0, "Negative": 0}
    plt.figure(figsize=(6, 4))
    sentiments_list = list(percentages.keys())
    percents_list = list(percentages.values())
    bars = plt.bar(sentiments_list, percents_list, color=["green", "blue", "red"])
    plt.xlabel("Sentiment")
    plt.ylabel("Percentage")
    plt.title("ABSA Sentiment Analysis Summary")
    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2.0, yval, f'{yval:.1f}%', va='bottom', ha='center')
    buf = io.BytesIO()
    plt.savefig(buf, format='png')
    plt.close()
    buf.seek(0)
    chart_b64 = base64.b64encode(buf.read()).decode("utf-8")
    chart_data_uri = f"data:image/png;base64,{chart_b64}"
    return jsonify({
        "message": "ABSA completed.",
        "results": results,
        "stats": summary,
        "chart": chart_data_uri
    }), 200

@app.route('/process/zero_shot_sentiment', methods=['POST'])
def process_zero_shot_sentiment():
    params = request.get_json()
    if not params:
        return jsonify({"error": "No JSON payload provided."}), 400
    csv_b64 = params.get("base64")
    file_type = params.get("fileType", "csv").lower()
    column = params.get("column")
    model_name = params.get("model")
    if not all([csv_b64, column]):
        missing = [param for param in ["base64", "column"] if not params.get(param)]
        return jsonify({"error": f"Parameters 'base64' and 'column' are required."}), 400
    try:
        csv_bytes = base64.b64decode(csv_b64)
        if file_type == "csv":
            df, _ = parse_csv_from_bytes(csv_bytes)
        elif file_type == "xlsx":
            df, _ = parse_xlsx_from_bytes(csv_bytes)
        else:
            return jsonify({"error": f"Unsupported file type '{file_type}'."}), 400
    except Exception as e:
        return jsonify({"error": f"Error decoding file: {str(e)}"}), 400
    if column not in df.columns:
        return jsonify({"error": f"Column '{column}' not found in dataset."}), 400
    texts = df[column].astype(str).dropna().tolist()
    if not texts:
        return jsonify({"error": "No valid text data found in the specified column."}), 400
    results = []
    try:
        for text in tqdm(texts, desc="Processing zero-shot sentiment", unit="text"):
            prompt = (
                f"Please label the following text as Positive, Negative, or Neutral. Dont give any explanation, just label rationally and nothing else.\n\n"
                f"Text: \"{text}\"\n\nSentiment:"
            )
            response = ollama.chat(
                model=model_name,
                messages=[{'role': 'user', 'content': prompt}]
            )
            sentiment = response.message.content.strip().capitalize()
            if sentiment not in ["Positive", "Negative", "Neutral"]:
                sentiment = "Neutral"
            results.append({
                "text": text,
                "sentiment": sentiment
            })
    except Exception as e:
        return jsonify({"error": f"Error during zero-shot sentiment analysis: {str(e)}"}), 500
    summary = {
        "Positive": {"Count": 0},
        "Neutral":  {"Count": 0},
        "Negative": {"Count": 0}
    }
    for r in results:
        s = r["sentiment"]
        if s in summary:
            summary[s]["Count"] += 1
    total_count = summary["Positive"]["Count"] + summary["Neutral"]["Count"] + summary["Negative"]["Count"]
    if total_count > 0:
        percentages = {
            "Positive": summary["Positive"]["Count"] * 100 / total_count,
            "Neutral":  summary["Neutral"]["Count"] * 100 / total_count,
            "Negative": summary["Negative"]["Count"] * 100 / total_count
        }
    else:
        percentages = {"Positive": 0, "Neutral": 0, "Negative": 0}
    plt.figure(figsize=(6, 4))
    sentiments_list = list(percentages.keys())
    percents_list = list(percentages.values())
    bars = plt.bar(sentiments_list, percents_list, color=["green", "blue", "red"])
    plt.xlabel("Sentiment")
    plt.ylabel("Percentage")
    plt.title("Zero-Shot Sentiment Analysis Summary")
    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2.0, yval, f'{yval:.1f}%', va='bottom', ha='center')
    buf = io.BytesIO()
    plt.savefig(buf, format='png')
    plt.close()
    buf.seek(0)
    chart_b64 = base64.b64encode(buf.read()).decode("utf-8")
    chart_data_uri = f"data:image/png;base64,{chart_b64}"
    return jsonify({
        "message": "Zero-shot sentiment analysis completed.",
        "results": results,
        "stats": summary,
        "chart": chart_data_uri
    }), 200

@app.route('/system_stats', methods=['GET'])
def system_stats():
    cpu_utilization = psutil.cpu_percent(interval=1)
    ram_info = psutil.virtual_memory()
    ram_total = ram_info.total / (1024 ** 3)
    ram_available = ram_info.available / (1024 ** 3)
    ram_utilization = ram_info.percent
    stats = {
        "cpu_utilization_percent": cpu_utilization,
        "ram_utilization_percent": ram_utilization,
    }
    return jsonify(stats), 200

if __name__ == '__main__':
    app.run(debug=True)
